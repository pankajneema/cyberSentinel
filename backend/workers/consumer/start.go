package consumer

import (
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"workers/config"
	"workers/utils"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Start boots the consumer and begins message processing.
//
// Messages are processed by a BOUNDED CONCURRENT worker pool (size
// cfg.JobMaxConcurrency) rather than one-at-a-time, so the channel prefetch is
// actually used and N scans run in parallel. Each message still Acks only after
// successful processing and Nacks (requeue=false → DLQ) on failure. On SIGINT/
// SIGTERM the consumer stops accepting new deliveries and drains in-flight work
// (bounded by a timeout) before returning, so a scan isn't abandoned mid-write.
func Start(cfg *config.Config) error {
	utils.Logger.Infof("connecting to RabbitMQ")

	// The consumer serves TWO dedicated job queues that feed the SAME worker
	// pool: jobs.asm (ASM discovery) and jobs.vs (vulnerability scanning). Each
	// queue has its own connection/channel so Ack/Nack are routed back to the
	// queue the delivery came from.
	asmQueue, err := utils.Connect(cfg.RabbitURL, cfg.ASMRabbitJobQueue)
	if err != nil {
		return err
	}
	defer asmQueue.Close()

	vsQueue, err := utils.Connect(cfg.RabbitURL, cfg.VSRabbitJobQueue)
	if err != nil {
		return err
	}
	defer vsQueue.Close()

	asmMsgs, err := asmQueue.Consume()
	if err != nil {
		return err
	}
	vsMsgs, err := vsQueue.Consume()
	if err != nil {
		return err
	}

	concurrency := cfg.JobMaxConcurrency
	if concurrency < 1 {
		concurrency = 1
	}
	utils.Logger.Infof("consumer started (concurrency=%d) queues=[%s %s], waiting for messages...",
		concurrency, cfg.ASMRabbitJobQueue, cfg.VSRabbitJobQueue)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sem := make(chan struct{}, concurrency) // bounds in-flight goroutines
	var wg sync.WaitGroup

	drain := func() {
		utils.Logger.Infof("draining %d in-flight job(s)...", len(sem))
		done := make(chan struct{})
		go func() { wg.Wait(); close(done) }()
		select {
		case <-done:
			utils.Logger.Infof("all in-flight jobs drained cleanly")
		case <-time.After(30 * time.Second):
			utils.Logger.Warnf("drain timeout — some jobs still in-flight will redeliver")
		}
	}

	// process dispatches one delivery on the bounded worker pool, Acking after
	// success and Nacking (requeue=false → DLQ) on failure, against the queue
	// the delivery originated from. Shared by both job queues.
	process := func(q *utils.Queue, msg amqp.Delivery) {
		m := msg          // per-iteration copy captured by the goroutine
		sem <- struct{}{} // block if at capacity (backpressure)
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			if err := dispatch(m.Body); err != nil {
				// Poison/failed message → DLQ (requeue=false), never a hot loop.
				utils.Logger.Errorf("message failed, dead-lettering: %v", err)
				_ = q.Nack(m, false)
				return
			}
			_ = q.Ack(m)
		}()
	}

	for {
		select {
		case msg, ok := <-asmMsgs:
			if !ok {
				utils.Logger.Warnf("asm delivery channel closed; draining and exiting")
				drain()
				return nil
			}
			process(asmQueue, msg)

		case msg, ok := <-vsMsgs:
			if !ok {
				utils.Logger.Warnf("vs delivery channel closed; draining and exiting")
				drain()
				return nil
			}
			process(vsQueue, msg)

		case sig := <-sigChan:
			utils.Logger.Infof("shutdown signal received: %s — stopping intake", sig)
			drain()
			return nil
		}
	}
}

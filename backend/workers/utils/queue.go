package utils

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// drainTimeout bounds how long StartConsumer waits for in-flight jobs to finish
// on shutdown before returning (un-drained jobs redeliver).
const drainTimeout = 30 * time.Second

// publishConfirmTimeout bounds how long Publish waits for a broker ack when the
// caller's context carries no deadline of its own.
const publishConfirmTimeout = 10 * time.Second

// Queue wraps RabbitMQ connection & channel
type Queue struct {
	conn    *amqp.Connection
	channel *amqp.Channel
	queue   amqp.Queue
}

// Connect initializes RabbitMQ connection and queue
func Connect(rabbitURL, queueName string) (*Queue, error) {
	if rabbitURL == "" {
		return nil, errors.New("rabbitmq url is empty")
	}

	conn, err := amqp.Dial(rabbitURL)
	if err != nil {
		return nil, err
	}

	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, err
	}

	// Enable publisher confirms so Publish() can detect broker-side failures.
	if err := ch.Confirm(false); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}

	// Dead-letter topology: poison/expired messages route here instead of
	// being requeued forever (audit M-1). Exchange + queue + binding.
	dlxName := queueName + ".dlx"
	dlqName := queueName + ".dlq"
	if err := ch.ExchangeDeclare(dlxName, "fanout", true, false, false, false, nil); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	if _, err := ch.QueueDeclare(dlqName, true, false, false, false, nil); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	if err := ch.QueueBind(dlqName, "", dlxName, false, nil); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}

	// NOTE: an existing queue declared without these args cannot be redeclared
	// with them (RabbitMQ returns PRECONDITION_FAILED). On first rollout, drain
	// and delete the old queue so it is recreated with the dead-letter args.
	q, err := ch.QueueDeclare(
		queueName, // name
		true,      // durable
		false,     // autoDelete
		false,     // exclusive
		false,     // noWait
		amqp.Table{
			"x-dead-letter-exchange": dlxName,
		},
	)
	if err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}

	// Prefetch: a consumer only holds a bounded number of unacked messages,
	// enabling fair dispatch across workers (audit M-1).
	if err := ch.Qos(16, 0, false); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}

	return &Queue{
		conn:    conn,
		channel: ch,
		queue:   q,
	}, nil
}

// Publish sends a message to the queue and waits for the broker's publisher
// confirm before returning. The channel is in confirm mode (see Connect), so a
// successful return means RabbitMQ has durably accepted the message; a broker
// nack or a confirm timeout is surfaced as an error so callers (which already
// treat publish failure as fatal / dead-letter-worthy) can react instead of
// silently losing the message.
func (q *Queue) Publish(ctx context.Context, body []byte) error {
	conf, err := q.channel.PublishWithDeferredConfirmWithContext(
		ctx,
		"",           // exchange
		q.queue.Name, // routing key
		false,        // mandatory
		false,        // immediate
		amqp.Publishing{
			ContentType:  "application/json",
			Body:         body,
			DeliveryMode: amqp.Persistent,
		},
	)
	if err != nil {
		return err
	}

	// Bound the wait: honor the caller's deadline if it has one, otherwise apply
	// a default timeout so a stalled broker cannot block the caller forever.
	waitCtx := ctx
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		waitCtx, cancel = context.WithTimeout(ctx, publishConfirmTimeout)
		defer cancel()
	}

	acked, err := conf.WaitContext(waitCtx)
	if err != nil {
		return fmt.Errorf("publish confirm wait failed: %w", err)
	}
	if !acked {
		return errors.New("publish nacked by broker")
	}
	return nil
}

// Consume starts consuming messages
func (q *Queue) Consume() (<-chan amqp.Delivery, error) {
	return q.channel.Consume(
		q.queue.Name,
		"",    // consumer tag
		false, // autoAck
		false, // exclusive
		false, // noLocal
		false, // noWait
		nil,   // args
	)
}

// Ack acknowledges a message
func (q *Queue) Ack(d amqp.Delivery) error {
	return d.Ack(false)
}

// Nack rejects a message
func (q *Queue) Nack(d amqp.Delivery, requeue bool) error {
	return d.Nack(false, requeue)
}

// Close closes channel and connection
func (q *Queue) Close() {
	if q.channel != nil {
		_ = q.channel.Close()
	}
	if q.conn != nil {
		_ = q.conn.Close()
	}
}

// qmsg pairs a delivery with the queue it came from, so Ack/Nack are routed
// back to the originating queue.
type qmsg struct {
	q *Queue
	d amqp.Delivery
}

// StartConsumer boots the consumer and begins message processing across all
// given job queues, feeding a single BOUNDED CONCURRENT worker pool (size
// concurrency) so the channel prefetch is actually used and N jobs run in
// parallel. Each message Acks only after Dispatch succeeds and Nacks
// (requeue=false → DLQ) on failure. On SIGINT/SIGTERM (or any delivery channel
// closing) the consumer stops accepting new deliveries and drains in-flight
// work (bounded by drainTimeout) before returning, so a job isn't abandoned
// mid-write. Routing to the owning service is done by message type via the
// dispatcher registry.
func StartConsumer(rabbitURL string, queueNames []string, concurrency int) error {
	Logger.Infof("connecting to RabbitMQ")

	// Each queue gets its own connection/channel so Ack/Nack are routed back to
	// the queue the delivery came from. All queues feed the SAME worker pool.
	queues := make([]*Queue, 0, len(queueNames))
	defer func() {
		for _, q := range queues {
			q.Close()
		}
	}()

	merged := make(chan qmsg)
	closedCh := make(chan string, len(queueNames))

	for _, name := range queueNames {
		q, err := Connect(rabbitURL, name)
		if err != nil {
			return err
		}
		queues = append(queues, q)

		msgs, err := q.Consume()
		if err != nil {
			return err
		}

		// Fan-in: forward this queue's deliveries onto the shared channel, and
		// signal when the delivery channel closes (broker/connection loss).
		go func(q *Queue, c <-chan amqp.Delivery, name string) {
			for d := range c {
				merged <- qmsg{q: q, d: d}
			}
			closedCh <- name
		}(q, msgs, name)
	}

	if concurrency < 1 {
		concurrency = 1
	}
	Logger.Infof("consumer started (concurrency=%d) queues=%v, waiting for messages...",
		concurrency, queueNames)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sem := make(chan struct{}, concurrency) // bounds in-flight goroutines
	var wg sync.WaitGroup

	drain := func() {
		Logger.Infof("draining %d in-flight job(s)...", len(sem))
		done := make(chan struct{})
		go func() { wg.Wait(); close(done) }()
		select {
		case <-done:
			Logger.Infof("all in-flight jobs drained cleanly")
		case <-time.After(drainTimeout):
			Logger.Warnf("drain timeout — some jobs still in-flight will redeliver")
		}
	}

	// process dispatches one delivery on the bounded worker pool, Acking after
	// success and Nacking (requeue=false → DLQ) on failure, against the queue
	// the delivery originated from.
	process := func(q *Queue, msg amqp.Delivery) {
		m := msg          // per-iteration copy captured by the goroutine
		sem <- struct{}{} // block if at capacity (backpressure)
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			if err := Dispatch(m.Body); err != nil {
				// Poison/failed message → DLQ (requeue=false), never a hot loop.
				Logger.Errorf("message failed, dead-lettering: %v", err)
				_ = q.Nack(m, false)
				return
			}
			_ = q.Ack(m)
		}()
	}

	for {
		select {
		case pair := <-merged:
			process(pair.q, pair.d)

		case name := <-closedCh:
			Logger.Warnf("%s delivery channel closed; draining and exiting", name)
			drain()
			return nil

		case sig := <-sigChan:
			Logger.Infof("shutdown signal received: %s — stopping intake", sig)
			drain()
			return nil
		}
	}
}

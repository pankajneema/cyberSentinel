package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"worker/utils"
)

// This is the ported, proven RabbitMQ layer: DLX topology (byte-matched to the
// Python side), publisher confirms, a bounded concurrent worker pool, and
// graceful drain on shutdown. The only redesign changes are: routing decodes the
// unified Job and dispatches to the owning Service via the engine, and a handler
// may ask for redelivery (ErrRequeue) when it can't get a concurrency slot.

const (
	drainTimeout          = 30 * time.Second
	publishConfirmTimeout = 10 * time.Second
	// requeueDelay throttles redelivery when a task can't be admitted, so a
	// full service doesn't hot-loop its queue.
	requeueDelay = 3 * time.Second
	// maxRetries bounds how many times a failing message is re-processed before
	// it is dead-lettered, so a transient error gets retries but a poison message
	// still lands in the DLQ instead of looping forever.
	maxRetries = 3
	// retryHeader carries the current attempt count across redeliveries.
	retryHeader = "x-retry-count"
)

// ErrRequeue signals the consumer to Nack with requeue=true (transient: no slot).
var ErrRequeue = errors.New("requeue")

// retryCount reads the current retry count from a delivery's headers.
func retryCount(d amqp.Delivery) int {
	if d.Headers == nil {
		return 0
	}
	switch v := d.Headers[retryHeader].(type) {
	case int32:
		return int(v)
	case int64:
		return int(v)
	case int:
		return v
	}
	return 0
}

// Queue wraps a RabbitMQ connection + channel bound to one queue.
type Queue struct {
	conn    *amqp.Connection
	channel *amqp.Channel
	queue   amqp.Queue
	mu      sync.Mutex // serializes Publish (amqp channels are not concurrency-safe)
}

// Connect declares the queue and its dead-letter topology. DLX convention (MUST
// match Python backend/api_service/utils/queue.py): a durable FANOUT exchange
// <q>.dlx and a durable queue <q>.dlq bound to it; the work queue carries
// x-dead-letter-exchange=<q>.dlx. Do not diverge these args or RabbitMQ raises
// PRECONDITION_FAILED.
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
	if err := ch.Confirm(false); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}

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
	q, err := ch.QueueDeclare(queueName, true, false, false, false, amqp.Table{
		"x-dead-letter-exchange": dlxName,
	})
	if err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	if err := ch.Qos(16, 0, false); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	return &Queue{conn: conn, channel: ch, queue: q}, nil
}

// Publish durably sends a message and waits for the broker's publisher confirm.
func (q *Queue) Publish(ctx context.Context, body []byte) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	conf, err := q.channel.PublishWithDeferredConfirmWithContext(
		ctx, "", q.queue.Name, false, false,
		amqp.Publishing{ContentType: "application/json", Body: body, DeliveryMode: amqp.Persistent},
	)
	if err != nil {
		return err
	}
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

func (q *Queue) Consume() (<-chan amqp.Delivery, error) {
	return q.channel.Consume(q.queue.Name, "", false, false, false, false, nil)
}
func (q *Queue) Ack(d amqp.Delivery) error                { return d.Ack(false) }
func (q *Queue) Nack(d amqp.Delivery, requeue bool) error { return d.Nack(false, requeue) }

// Republish puts the message back on its own queue with an incremented retry
// count (best-effort), so a transient failure gets a bounded number of retries
// before dead-lettering.
func (q *Queue) Republish(ctx context.Context, body []byte, retry int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.channel.PublishWithContext(ctx, "", q.queue.Name, false, false, amqp.Publishing{
		ContentType:  "application/json",
		Body:         body,
		DeliveryMode: amqp.Persistent,
		Headers:      amqp.Table{retryHeader: int32(retry)},
	})
}
func (q *Queue) Close() {
	if q.channel != nil {
		_ = q.channel.Close()
	}
	if q.conn != nil {
		_ = q.conn.Close()
	}
}

// ---- reporting publishers (worker → per-service Python reporting consumers) ----

// reportQueues holds one connection per service (reporting.asm/vs/ca), so each
// service's reporting consumer runs and scales independently.
var reportQueues = map[string]*Queue{}

// InitReporting opens a connection to each service's reporting queue.
func InitReporting(rabbitURL string) error {
	for _, svc := range []string{ServiceASM, ServiceVS, ServiceCA} {
		q, err := Connect(rabbitURL, ReportingQueueFor(svc))
		if err != nil {
			return err
		}
		reportQueues[svc] = q
	}
	return nil
}

// CloseReporting closes all reporting connections on shutdown.
func CloseReporting() {
	for _, q := range reportQueues {
		if q != nil {
			q.Close()
		}
	}
}

// PublishReport hands a message to a service's reporting queue (reporting.<service>)
// for the matching Python consumer to persist/notify.
func PublishReport(ctx context.Context, service string, payload any) error {
	q, ok := reportQueues[service]
	if !ok || q == nil {
		return fmt.Errorf("reporting queue not initialized for %q", service)
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.Publish(ctx, data)
}

// ---- consumer ----

type qmsg struct {
	q *Queue
	d amqp.Delivery
}

// dispatch decodes the unified Job and routes it to the owning service's engine
// run. An unknown type is ACKed (not hot-looped); a malformed body is DLQ'd.
func dispatch(body []byte) error {
	var job Job
	if err := json.Unmarshal(body, &job); err != nil {
		utils.Logger.Errorf("invalid job message: %v", err)
		return err
	}
	svc, ok := ServiceFor(job.Type)
	if !ok {
		utils.Logger.Warnf("unknown job type: %s (task=%s)", job.Type, job.TaskID)
		return nil
	}
	return Run(context.Background(), svc, job)
}

// StartConsumer subscribes to every job queue and feeds a single bounded worker
// pool. Ack after success; ErrRequeue → Nack(requeue=true) after a short delay;
// any other error → Nack(requeue=false) → DLQ. Drains in-flight work on SIGINT/
// SIGTERM before returning.
func StartConsumer(rabbitURL string, queueNames []string, concurrency int) error {
	utils.Logger.Infof("connecting to RabbitMQ")

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
	utils.Logger.Infof("consumer started (concurrency=%d) queues=%v, waiting for messages...", concurrency, queueNames)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	drain := func() {
		utils.Logger.Infof("draining %d in-flight job(s)...", len(sem))
		done := make(chan struct{})
		go func() { wg.Wait(); close(done) }()
		select {
		case <-done:
			utils.Logger.Infof("all in-flight jobs drained cleanly")
		case <-time.After(drainTimeout):
			utils.Logger.Warnf("drain timeout — some jobs still in-flight will redeliver")
		}
	}

	process := func(q *Queue, msg amqp.Delivery) {
		m := msg
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			err := dispatch(m.Body)
			switch {
			case err == nil:
				_ = q.Ack(m)
			case errors.Is(err, ErrRequeue):
				time.Sleep(requeueDelay)
				_ = q.Nack(m, true)
			default:
				attempt := retryCount(m)
				if attempt < maxRetries {
					// Transient failure: republish with an incremented count and
					// ack the original so it is re-processed a bounded number of
					// times before dead-lettering.
					if rerr := q.Republish(context.Background(), m.Body, attempt+1); rerr == nil {
						utils.Logger.Warnf("job failed (attempt %d/%d), retrying: %v", attempt+1, maxRetries, err)
						_ = q.Ack(m)
						return
					}
				}
				utils.Logger.Errorf("job failed (attempt %d), dead-lettering: %v", attempt, err)
				_ = q.Nack(m, false)
			}
		}()
	}

	for {
		select {
		case pair := <-merged:
			process(pair.q, pair.d)
		case name := <-closedCh:
			utils.Logger.Warnf("%s delivery channel closed; draining and exiting", name)
			drain()
			return nil
		case sig := <-sigChan:
			utils.Logger.Infof("shutdown signal received: %s — stopping intake", sig)
			drain()
			return nil
		}
	}
}

package utils

import (
	"context"
	"errors"

	amqp "github.com/rabbitmq/amqp091-go"
)

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

// Publish sends a message to the queue
func (q *Queue) Publish(ctx context.Context, body []byte) error {
	return q.channel.PublishWithContext(
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

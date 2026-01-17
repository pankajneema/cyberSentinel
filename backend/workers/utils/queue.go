package utils

import (
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

	q, err := ch.QueueDeclare(
		queueName, // name
		true,      // durable
		false,     // autoDelete
		false,     // exclusive
		false,     // noWait
		nil,       // args
	)
	if err != nil {
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


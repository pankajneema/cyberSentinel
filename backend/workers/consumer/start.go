package consumer

import (
	"os"
	"os/signal"
	"syscall"

	"workers/config"
	"workers/utils"
)

// Start boots the consumer and begins message processing
func Start(cfg *config.Config) error {
	utils.Logger.Infof("connecting to RabbitMQ")

	queue, err := utils.Connect(cfg.RabbitURL, cfg.RabbitJobQueue)
	if err != nil {
		return err
	}
	defer queue.Close()

	msgs, err := queue.Consume()
	if err != nil {
		return err
	}

	utils.Logger.Infof("consumer started, waiting for messages...")

	// Graceful shutdown handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case msg := <-msgs:
			utils.Logger.Debugf("message received")

			err := dispatch(msg.Body)
			if err != nil {
				utils.Logger.Errorf("message failed, requeueing: %v", err)
				_ = queue.Nack(msg, true)
				continue
			}

			_ = queue.Ack(msg)

		case sig := <-sigChan:
			utils.Logger.Infof("shutdown signal received: %s", sig)
			return nil
		}
	}
}


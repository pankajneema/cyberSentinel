package consumer

import (
	"encoding/json"

	"workers/consumer/handlers"
	"workers/utils"
)

type QueueMessage struct {
	Type string `json:"type"`
}

func dispatch(body []byte) error {
	var msg QueueMessage
	if err := json.Unmarshal(body, &msg); err != nil {
		utils.Logger.Errorf("invalid message: %v", err)
		return err
	}

	switch msg.Type {
	case "job":
		return handlers.HandleJob(body)
	default:
		utils.Logger.Warnf("unknown message type: %s", msg.Type)
	}

	return nil
}


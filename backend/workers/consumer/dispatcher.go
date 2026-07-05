package consumer

import (
	"encoding/json"

	"workers/consumer/asm"
	vsjob "workers/consumer/vs"
	"workers/orchestration"
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
	case orchestration.JobTypeASM:
		return asm.HandleJob(body)
	case orchestration.JobTypeVS:
		return vsjob.HandleJob(body)
	default:
		utils.Logger.Warnf("unknown message type: %s", msg.Type)
	}

	return nil
}

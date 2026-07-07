// Package asm handles Attack Surface Management (ASM) jobs consumed from
// jobs.asm. Like the VS path, the scan runs IN-PROCESS: HandleJob registers the
// job and executes the orchestration pipeline synchronously, so the RabbitMQ ACK
// only completes once the scan reaches a terminal state (ACK-after-success).
package asm

import (
	"encoding/json"
	"errors"

	"workers/utils"
)

// ---- ASM job contract ----

// jobMsg is the jobs.asm envelope published by the API.
type jobMsg struct {
	Type   string `json:"type"`
	UserID string `json:"user_id"`
	ID     string `json:"id"`
}

// HandleJob registers and runs one ASM discovery. It returns nil once the scan
// reaches a terminal state (consumer ACKs) and a non-nil error otherwise
// (consumer Nacks → DLQ for inspection/replay). An idempotent redelivery of an
// already COMPLETED/RUNNING discovery returns nil (ACK, no re-run).
func HandleJob(body []byte) error {
	var job jobMsg
	if err := json.Unmarshal(body, &job); err != nil {
		utils.Logger.Errorf("[ASM][INVALID_MESSAGE] error=%v", err)
		return err
	}

	utils.Logger.Infof("[ASM][QUEUE_RECEIVED] job_id=%s user_id=%s type=%s",
		job.ID, job.UserID, job.Type)

	o := &Job{
		ID:     job.ID,
		Type:   JobTypeASM,
		UserID: job.UserID,
	}

	// Register: builds the pipeline, stores it in Redis, sets status=RUNNING.
	if err := RegisterJob(o); err != nil {
		// Idempotent redelivery: discovery already COMPLETED or actively RUNNING
		// on another worker. ACK without re-running — not a failure.
		if errors.Is(err, ErrAlreadyProcessed) {
			utils.Logger.Infof("[ASM][ALREADY_PROCESSED] job_id=%s — acking without re-run", job.ID)
			return nil
		}
		utils.Logger.Errorf("[ASM][REGISTER_FAILED] job_id=%s error=%v", job.ID, err)
		return err
	}

	// Execute SYNCHRONOUSLY (ACK-after-success). A crash mid-scan leaves the
	// message un-ACKed → dead-lettered (requeue=false), never silently dropped.
	if err := ExecuteJob(o.ID); err != nil {
		utils.Logger.Errorf("[ASM][EXECUTE_FAILED] job_id=%s error=%v", job.ID, err)
		_ = RemoveJob(o.ID)
		return err
	}

	_ = RemoveJob(o.ID) // drop from in-memory registry (no leak)
	utils.Logger.Infof("[ASM][JOB_COMPLETED] job_id=%s user_id=%s", job.ID, job.UserID)
	return nil
}

package asm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"workers/config"
	"workers/utils"
)

// Bounded HTTP client. The control-plane now executes the scan SYNCHRONOUSLY and
// only responds when the job reaches a terminal state (ACK-after-success), so this
// timeout must exceed the worst-case scan time (TASK_TIMEOUT_SECONDS, default 15m)
// plus a margin. Keep it just above the job budget so a truly hung control-plane
// still can't block the consumer forever.
var controlPlaneClient = &http.Client{Timeout: 20 * time.Minute}

// JobMessage represents a job event (QUEUE → ASM API)
type JobMessage struct {
	Type   string `json:"type"`
	UserID string `json:"user_id"`
	ID     string `json:"id"`
}

// HandleJob handles job messages from queue
func HandleJob(body []byte) error {
	utils.Logger.Infof(
		"[ASM][QUEUE_RECEIVED] raw_body=%s",
		string(body),
	)

	var job JobMessage
	if err := json.Unmarshal(body, &job); err != nil {
		utils.Logger.Errorf(
			"[ASM][INVALID_MESSAGE] error=%v raw_body=%s",
			err,
			string(body),
		)
		return err
	}

	utils.Logger.Infof(
		"[ASM][PARSED_JOB] job_id=%s user_id=%s type=%s",
		job.ID,
		job.UserID,
		job.Type,
	)

	cfg := config.Load()

	// 🔹 Marshal payload (API compatible)
	data, err := json.Marshal(job)
	if err != nil {
		utils.Logger.Errorf(
			"[ASM][MARSHAL_FAILED] job_id=%s error=%v",
			job.ID,
			err,
		)
		return err
	}

	url := cfg.AsmEndpoint + "jobs/start"

	utils.Logger.Infof(
		"[ASM][HTTP_REQUEST] method=POST url=%s job_id=%s",
		url,
		job.ID,
	)

	req, err := http.NewRequest(
		http.MethodPost,
		url,
		bytes.NewBuffer(data),
	)
	if err != nil {
		utils.Logger.Errorf(
			"[ASM][REQUEST_CREATE_FAILED] job_id=%s error=%v",
			job.ID,
			err,
		)
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if cfg.ControlPlaneToken != "" {
		req.Header.Set("X-Internal-Token", cfg.ControlPlaneToken)
	}

	resp, err := controlPlaneClient.Do(req)
	if err != nil {
		utils.Logger.Errorf(
			"[ASM][HTTP_FAILED] job_id=%s error=%v",
			job.ID,
			err,
		)
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 300 {
		utils.Logger.Errorf(
			"[ASM][HTTP_ERROR] job_id=%s status=%d response=%s",
			job.ID,
			resp.StatusCode,
			string(respBody),
		)
		// Return an error so the message is NOT acked — it dead-letters for
		// inspection/replay instead of being silently dropped (job loss).
		return fmt.Errorf("control-plane rejected job %s: status %d", job.ID, resp.StatusCode)
	}

	utils.Logger.Infof(
		"[ASM][JOB_ACCEPTED] job_id=%s status=%d response=%s",
		job.ID,
		resp.StatusCode,
		string(respBody),
	)

	return nil
}

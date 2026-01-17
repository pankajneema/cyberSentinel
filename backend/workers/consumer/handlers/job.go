package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"

	"workers/utils"
)

// JobMessage represents a job event
type JobMessage struct {
	Type    string `json:"type"`
	JobID   string `json:"job_id"`
	JobKind string `json:"job_kind"`
}

// HandleJob handles job messages from queue
func HandleJob(body []byte) error {
	var job JobMessage
	if err := json.Unmarshal(body, &job); err != nil {
		utils.Logger.Errorf("invalid job message: %v", err)
		return err
	}

	utils.Logger.Infof("received job: %s (%s)", job.JobID, job.JobKind)

	req, err := http.NewRequest(
		http.MethodPost,
		"http://localhost:8080/internal/jobs/start",
		bytes.NewBuffer(body),
	)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		utils.Logger.Errorf("gin returned status: %d", resp.StatusCode)
	}

	return nil
}


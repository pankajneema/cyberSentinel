package core

import (
	"context"
	"encoding/json"
	"time"

	"worker/config"
	"worker/tools"
)

// taskTTL bounds how long a finished task's live state lingers in Redis.
const taskTTL = 24 * time.Hour

// Job is the unified message published by Python and consumed by the worker.
// Its shape is a locked contract (see contract.go). asset_id may be JSON null →
// decodes to "".
type Job struct {
	Type     string         `json:"type"`
	Priority string         `json:"priority"`
	TaskID   string         `json:"task_id"`
	OrgID    string         `json:"org_id"`
	AssetID  string         `json:"asset_id"`
	Targets  []string       `json:"targets"`
	Mode     string         `json:"mode"` // LIGHT | NORMAL | DEEP
	Config   map[string]any `json:"config"`
}

// Stage is one step of a pipeline: a human-readable Name and the registry Tool
// that runs it, plus its runtime status/result.
type Stage struct {
	Name      string         `json:"name"`
	Tool      string         `json:"tool"`
	Status    StageStatus    `json:"status"`
	Result    map[string]any `json:"result,omitempty"`
	Error     string         `json:"error,omitempty"`
	StartedAt string         `json:"started_at,omitempty"`
	EndedAt   string         `json:"ended_at,omitempty"`
}

// Task is the live pipeline instance mirrored in Redis (key task:{task_id}).
type Task struct {
	TaskID       string    `json:"task_id"`
	OrgID        string    `json:"org_id"`
	AssetID      string    `json:"asset_id"`
	Service      string    `json:"service"`
	Status       TaskState `json:"status"`
	CurrentStage string    `json:"current_stage"`
	Stages       []Stage   `json:"stages"`
	StartedAt    string    `json:"started_at"`

	// job carries the original message; accumulated holds prior stage outputs by
	// stage name; findings is the flat, running list every later stage can read
	// (by finding Type) so tools chain without hard-coding stage names. None of
	// these are serialized to Redis.
	job         Job             `json:"-"`
	accumulated map[string]any  `json:"-"`
	findings    []tools.Finding `json:"-"`
}

// persist writes the live task state to Redis.
func (t *Task) persist(ctx context.Context) error {
	data, err := json.Marshal(t)
	if err != nil {
		return err
	}
	return config.Set(ctx, TaskKey(t.TaskID), data, taskTTL)
}

// LoadTask reads live task state from Redis (used by the reaper / query paths).
func LoadTask(ctx context.Context, taskID string) (*Task, error) {
	s, err := config.Get(ctx, TaskKey(taskID))
	if err != nil {
		return nil, err
	}
	var t Task
	if err := json.Unmarshal([]byte(s), &t); err != nil {
		return nil, err
	}
	return &t, nil
}

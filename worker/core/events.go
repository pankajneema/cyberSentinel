package core

import (
	"context"
	"time"

	"worker/config"
	"worker/utils"
)

// Event is the payload published to task_events:{org_id}. FastAPI SSE subscribes
// and streams these to the browser; the browser never reads Redis directly.
type Event struct {
	TaskID   string `json:"task_id"`
	OrgID    string `json:"org_id"`
	Service  string `json:"service"`
	Kind     string `json:"kind"`   // "task" | "stage"
	Status   string `json:"status"` // task state or stage status
	Stage    string `json:"stage,omitempty"`
	Tool     string `json:"tool,omitempty"`
	Progress int    `json:"progress"`
	Error    string `json:"error,omitempty"`
	TS       string `json:"ts"`
}

// emitTask publishes a task-level state change (ADMITTED/RUNNING/COMPLETED/…).
func emitTask(ctx context.Context, t *Task, progress int) {
	publish(ctx, Event{
		TaskID:   t.TaskID,
		OrgID:    t.OrgID,
		Service:  t.Service,
		Kind:     "task",
		Status:   string(t.Status),
		Progress: progress,
		TS:       time.Now().UTC().Format(time.RFC3339),
	})
}

// emitStage publishes a single stage transition.
func emitStage(ctx context.Context, t *Task, s Stage, progress int) {
	publish(ctx, Event{
		TaskID:   t.TaskID,
		OrgID:    t.OrgID,
		Service:  t.Service,
		Kind:     "stage",
		Status:   string(s.Status),
		Stage:    s.Name,
		Tool:     s.Tool,
		Progress: progress,
		Error:    s.Error,
		TS:       time.Now().UTC().Format(time.RFC3339),
	})
}

// publish is best-effort: a live-event failure must never fail a scan.
func publish(ctx context.Context, ev Event) {
	if ev.OrgID == "" {
		return
	}
	if err := config.Publish(ctx, EventsChannel(ev.OrgID), ev); err != nil {
		utils.Logger.Warnf("task_events publish failed (task=%s): %v", ev.TaskID, err)
	}
}

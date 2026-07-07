package asm

import (
	"context"
	"time"
)

// ---- job identity & lifecycle ----

// Job is the in-memory handle for one ASM discovery.
type Job struct {
	ID     string
	Type   string
	UserID string
	State  JobState
}

// JobState represents the lifecycle state of a job.
type JobState string

const (
	JobPending JobState = "PENDING"
	JobRunning JobState = "RUNNING"
	JobDone    JobState = "DONE"
	JobFailed  JobState = "FAILED"
)

// Job type discriminators carried in the queue message envelope.
const (
	JobTypeASM = "asm"
	JobTypeVS  = "vs"
)

// Task contains the minimum info needed by the executor. Only JobID flows in.
type Task struct {
	JobID string
}

// Result represents an execution outcome.
type Result struct {
	JobID   string
	Success bool
	Status  string
	Data    map[string]interface{}
	Error   string
	EndAt   time.Time
}

// ---- context helpers ----

// NewContext creates a cancellable context for the executor.
func NewContext() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}

// NewTimeoutContext creates a cancellable context bounded by a deadline so a
// hung tool cannot block a worker forever (audit C4). A non-positive value
// falls back to a plain cancellable context.
func NewTimeoutContext(seconds int) (context.Context, context.CancelFunc) {
	if seconds <= 0 {
		return NewContext()
	}
	return context.WithTimeout(context.Background(), time.Duration(seconds)*time.Second)
}

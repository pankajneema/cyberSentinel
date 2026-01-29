package executor

import "time"

// Task contains minimum info needed by executor
// Only JobID flows into executor
type Task struct {
	JobID string
}

// Result represents execution outcome
type Result struct {
	JobID   string
	Success bool
	Error   string
	EndAt   time.Time
}

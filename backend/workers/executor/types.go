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
	Status  string
	Data    map[string]interface{} // Add this field
	Error   string
	EndAt   time.Time
}

package orchestration

import "time"

// Job represents a high-level scan job
type Job struct {
	ID        string
	Kind      string
	State     JobState
	CreatedAt time.Time
	UpdatedAt time.Time
}


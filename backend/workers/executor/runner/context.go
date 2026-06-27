package runner

import (
	"context"
	"time"
)

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

package runner

import "context"

// NewContext creates cancellable context for executor
func NewContext() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}

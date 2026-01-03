package main

import (
	"context"
	"log"
	"os"
	"time"
)

// VS Scan Trigger Worker
//
// Responsibilities:
// - Read scheduled or on-demand vulnerability scan jobs from queue/API
// - Trigger scans via legacy /api/v1/scans endpoint
// - Record basic metadata for correlation
//
// Skeleton only: no real scanning logic.

func main() {
	logger := log.New(os.Stdout, "[vs-scan-trigger-worker] ", log.LstdFlags|log.Lmsgprefix)

	apiBase := envOrDefault("API_BASE_URL", "http://localhost:8000/api/v1")
	queueURL := envOrDefault("QUEUE_URL", "redis://localhost:6379/0")
	logger.Printf("starting worker (api=%s, queue=%s)", apiBase, queueURL)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	for {
		if err := triggerScans(ctx, logger, apiBase, queueURL); err != nil {
			logger.Printf("error triggering scans: %v", err)
		}
		select {
		case <-ctx.Done():
			logger.Println("context cancelled, shutting down")
			return
		case <-time.After(10 * time.Second):
		}
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func triggerScans(ctx context.Context, logger *log.Logger, apiBase, queueURL string) error {
	// TODO:
	// - Dequeue VS scan jobs from queueURL
	// - POST apiBase+"/scans" with appropriate payload
	// - Store mapping between job id and scan id
	logger.Println("triggerScans: placeholder implementation - no-op")
	return nil
}

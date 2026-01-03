package main

import (
	"context"
	"log"
	"os"
	"time"
)

// VS Normalization Worker
//
// Responsibilities:
// - Consume raw scan results from a queue
// - Normalize into platform-wide finding schema
// - Call backend VS APIs (e.g. /api/v1/vs/findings in future) to persist
//
// This is a placeholder only and performs no real normalization.

func main() {
	logger := log.New(os.Stdout, "[vs-normalization-worker] ", log.LstdFlags|log.Lmsgprefix)

	queueURL := envOrDefault("NORMALIZATION_QUEUE_URL", "redis://localhost:6379/1")
	apiBase := envOrDefault("API_BASE_URL", "http://localhost:8000/api/v1")
	logger.Printf("starting worker (api=%s, queue=%s)", apiBase, queueURL)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	for {
		if err := normalizeFindings(ctx, logger, apiBase, queueURL); err != nil {
			logger.Printf("error normalizing findings: %v", err)
		}
		select {
		case <-ctx.Done():
			logger.Println("context cancelled, shutting down")
			return
		case <-time.After(20 * time.Second):
		}
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func normalizeFindings(ctx context.Context, logger *log.Logger, apiBase, queueURL string) error {
	// TODO:
	// - Dequeue raw results from queueURL
	// - Transform into normalized finding records
	// - POST to future VS findings endpoints
	logger.Println("normalizeFindings: placeholder implementation - no-op")
	return nil
}

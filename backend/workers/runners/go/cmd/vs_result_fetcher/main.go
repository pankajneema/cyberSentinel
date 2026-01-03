package main

import (
	"context"
	"log"
	"os"
	"time"
)

// VS Result Fetcher Worker
//
// Responsibilities:
// - Poll scan status/results from /api/v1/scans/{id}
// - Push raw findings into an internal queue for normalization
//
// Skeleton only, with placeholder polling loop.

func main() {
	logger := log.New(os.Stdout, "[vs-result-fetcher-worker] ", log.LstdFlags|log.Lmsgprefix)

	apiBase := envOrDefault("API_BASE_URL", "http://localhost:8000/api/v1")
	queueURL := envOrDefault("NORMALIZATION_QUEUE_URL", "redis://localhost:6379/1")
	logger.Printf("starting worker (api=%s, normalization-queue=%s)", apiBase, queueURL)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	for {
		if err := fetchResults(ctx, logger, apiBase, queueURL); err != nil {
			logger.Printf("error fetching results: %v", err)
		}
		select {
		case <-ctx.Done():
			logger.Println("context cancelled, shutting down")
			return
		case <-time.After(15 * time.Second):
		}
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func fetchResults(ctx context.Context, logger *log.Logger, apiBase, queueURL string) error {
	// TODO:
	// - Identify scans that need result collection
	// - GET apiBase+"/scans/{id}"
	// - Enqueue raw results to NORMALIZATION_QUEUE_URL
	logger.Println("fetchResults: placeholder implementation - no-op")
	return nil
}

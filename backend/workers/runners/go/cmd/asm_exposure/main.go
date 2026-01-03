package main

import (
	"context"
	"log"
	"os"
	"time"
)

// ASM Exposure Analysis Worker
//
// Responsibilities:
// - Periodically read discovered assets from the backend
// - Compute or update exposure-related metadata (public vs internal, tags)
// - Persist results back to the central Asset Inventory API (/api/v1/assets)
//
// This is a skeleton with placeholder logic only.

func main() {
	logger := log.New(os.Stdout, "[asm-exposure-worker] ", log.LstdFlags|log.Lmsgprefix)

	apiBase := envOrDefault("API_BASE_URL", "http://localhost:8000/api/v1")
	logger.Printf("starting worker (api=%s)", apiBase)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	for {
		if err := analyseExposure(ctx, logger, apiBase); err != nil {
			logger.Printf("error analysing exposure: %v", err)
		}
		select {
		case <-ctx.Done():
			logger.Println("context cancelled, shutting down")
			return
		case <-time.After(30 * time.Second):
		}
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func analyseExposure(ctx context.Context, logger *log.Logger, apiBase string) error {
	// TODO:
	// - Call GET apiBase+"/asm/assets" and/or apiBase+"/assets"
	// - Derive exposure/risk tags based on rules
	// - PATCH apiBase+"/assets/{id}" with updated exposure/tags
	logger.Println("analyseExposure: placeholder implementation - no-op")
	return nil
}

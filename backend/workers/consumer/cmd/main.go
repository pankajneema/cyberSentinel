package main

import (
	"workers/config"
	"workers/utils"

	"workers/consumer"
)

func main() {
	// Load config
	cfg := config.Load()

	// Init logger
	utils.InitLogger(cfg.LogLevel)
	defer utils.Sync()

	utils.Logger.Infof("starting consumer service")

	// Start consumer
	err := consumer.Start(cfg)
	if err != nil {
		utils.Logger.Fatalf("consumer failed: %v", err)
	}
}


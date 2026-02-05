package main

import (
	"log"
	"workers/config"
	"workers/executor/runner"
	"workers/utils"

	"workers/control-plane/api"
)

func main() {
	cfg := config.Load()

	utils.InitLogger(cfg.LogLevel)
	defer utils.Sync()
	if err := runner.InitReportQueue(cfg.RabbitURL); err != nil {
		log.Fatalf("Failed to initialize report queue: %v", err)
	}
	defer runner.CloseReportQueue()

	utils.Logger.Info("starting control-plane (gin server)")

	if err := api.StartServer(cfg); err != nil {
		utils.Logger.Fatalf("gin server failed: %v", err)
	}
}

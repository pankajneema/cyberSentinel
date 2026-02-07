package main

import (
	"log"
	"workers/config"
	"workers/executor/runner"
	"workers/executor/tools"
	"workers/utils"

	"workers/control-plane/api"
)

func main() {
	cfg := config.Load()

	utils.InitLogger(cfg.LogLevel)
	defer utils.Sync()
	
	// Setup PATH to include Go bin directories
	tools.SetupPath()
	
	// Verify all required tools are available
	if err := tools.VerifyTools(); err != nil {
		utils.Logger.Warnf("tool verification failed: %v", err)
		utils.Logger.Warnf("continuing anyway, but tools may not work")
	}
	
	if err := runner.InitReportQueue(cfg.RabbitURL); err != nil {
		log.Fatalf("Failed to initialize report queue: %v", err)
	}
	defer runner.CloseReportQueue()

	utils.Logger.Info("starting control-plane (gin server)")

	if err := api.StartServer(cfg); err != nil {
		utils.Logger.Fatalf("gin server failed: %v", err)
	}
}

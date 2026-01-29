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

	utils.Logger.Infof("starting ASM service Consumer ...")
	utils.Logger.Infof("Consuming from queue: %s", cfg.ASMRabbitJobQueue)
	utils.Logger.Infof("ASM Microservice hitting endpoits: %s", cfg.AsmEndpoint)
	// Start consumer
	err := consumer.Start(cfg)
	if err != nil {
		utils.Logger.Fatalf("consumer failed: %v", err)
	}
}

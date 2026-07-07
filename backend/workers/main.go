// Command worker is the single entrypoint for the CyberSentinel worker. It boots
// the queue consumer and registers every service (ASM, VS, CA) so one binary
// serves all job types in-process. Routing to the owning service is by message
// type via the dispatcher registry in utils.
package main

import (
	"log"

	"workers/config"
	"workers/services/asm"
	"workers/services/vs"
	"workers/utils"
)

func main() {
	// Load config
	cfg := config.Load()

	// Init logger
	utils.InitLogger(cfg.LogLevel)
	defer utils.Sync()

	// ASM scans run in-process, so this worker owns the ASM tool PATH and the
	// report.asm publisher.
	utils.SetupPath()
	if err := utils.VerifyTools(); err != nil {
		utils.Logger.Warnf("tool verification failed: %v", err)
		utils.Logger.Warnf("continuing anyway, but tools may not work")
	}
	if err := asm.InitReportQueue(cfg.RabbitURL); err != nil {
		log.Fatalf("Failed to initialize report queue: %v", err)
	}
	defer asm.CloseReportQueue()

	// Each service registers its own job type → handler via module.Register. The
	// dispatcher routes by the message "type" field; the consumer never imports
	// the services' internals.
	asm.Register()
	vs.Register()

	// One consumer serves every job type in-process.
	utils.Logger.Infof("starting queue consumer (ASM + VS) ...")
	utils.Logger.Infof("consuming queues: %s, %s", cfg.ASMRabbitJobQueue, cfg.VSRabbitJobQueue)

	queues := []string{cfg.ASMRabbitJobQueue, cfg.VSRabbitJobQueue}
	if err := utils.StartConsumer(cfg.RabbitURL, queues, cfg.JobMaxConcurrency); err != nil {
		utils.Logger.Fatalf("consumer failed: %v", err)
	}
}

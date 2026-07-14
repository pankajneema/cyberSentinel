// Command worker is the single entrypoint for the CyberSentinel scan-execution
// worker. It boots the shared engine and consumes every service's job queues in
// one process. Execution only: consume → admit (Redis slot) → run pipeline →
// mirror state to Redis + task_events → hand findings/terminal to reporting.
// Intake, scheduling, the task command API, live SSE, reporting persistence and
// notifications all live in the Python (FastAPI) side.
package main

import (
	"time"

	"worker/config"
	"worker/core"
	_ "worker/services" // registers asm/vs/ca into the engine via init()
	"worker/utils"
)

func main() {
	cfg := config.Load()

	utils.InitLogger(cfg.LogLevel)
	defer utils.Sync()

	// The worker owns the scan-tool PATH.
	utils.SetupPath()
	if err := utils.VerifyTools(); err != nil {
		utils.Logger.Warnf("tool verification: %v (continuing; some pipelines may be degraded)", err)
	}

	// Durable state (findings/run status) + live state (slots/task/cancel/lease/pubsub).
	if err := config.InitPostgres(); err != nil {
		utils.Logger.Fatalf("postgres init failed: %v", err)
	}
	defer config.ClosePostgres()
	if err := config.InitRedis(); err != nil {
		utils.Logger.Fatalf("redis init failed: %v", err)
	}
	defer config.CloseRedis()

	// Reporting hand-off publisher.
	if err := core.InitReporting(cfg.RabbitURL); err != nil {
		utils.Logger.Fatalf("reporting queue init failed: %v", err)
	}
	defer core.CloseReporting()

	core.Configure(cfg)

	// Crash-recovery: fail tasks whose lease expired while RUNNING.
	core.StartReaper(time.Duration(cfg.LeaseTTLSec) * time.Second)

	// Services self-registered via the blank import; consume all their queues.
	queues := core.AllQueues()
	utils.Logger.Infof("starting consumer; queues=%v", queues)
	if err := core.StartConsumer(cfg.RabbitURL, queues, cfg.JobMaxConcurrency); err != nil {
		utils.Logger.Fatalf("consumer failed: %v", err)
	}
}

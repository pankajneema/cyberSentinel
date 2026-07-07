package vs

import "workers/utils"

// JobType is the queue message discriminator this service handles.
const JobType = "vs"

// Register wires the VS service into the dispatcher registry: the "vs" message
// type is routed to HandleJob, which scans each target with the enabled engine
// adapters and publishes a normalized report to report.vs. Call once at startup
// before the consumer begins pulling messages.
func Register() {
	utils.RegisterHandler(JobType, HandleJob)
}

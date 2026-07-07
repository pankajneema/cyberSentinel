package asm

import "workers/utils"

// Register wires the ASM service into the dispatcher registry: the JobTypeASM
// message type is routed to HandleJob, which registers the job, builds and runs
// the pipeline, and drives the orchestration flow. Call once at startup before
// the consumer begins pulling messages.
func Register() {
	utils.RegisterHandler(JobTypeASM, HandleJob)
}

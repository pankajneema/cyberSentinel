// Package core is the shared scan-execution engine. Every service (ASM, VS, CA)
// plugs into the SAME engine via the Service interface; only the stage list and
// the finding-save hook differ. This file locks the cross-language contracts
// (queue names, job message, task states, Redis key schema) that the Python
// publisher/consumer must agree with byte-for-byte. Change nothing here without
// making the matching change on the Python side (backend/api_service, reporting).
package core

// Service identifiers (also the job-message "type" discriminator).
const (
	ServiceASM = "asm"
	ServiceVS  = "vs"
	ServiceCA  = "ca"
)

// Job priorities → the ".high/.medium/.low" queue suffix.
const (
	PriorityHigh   = "high"
	PriorityMedium = "medium"
	PriorityLow    = "low"
)

// ReportingQueueFor returns the per-service queue the worker hands stage/terminal
// findings to (reporting.asm / reporting.vs / reporting.ca); the matching Python
// reporting consumer persists + notifies. Per-service so each runs independently.
func ReportingQueueFor(service string) string { return "reporting." + service }

// Scan modes / intensities (job.mode).
const (
	ModeLight  = "LIGHT"
	ModeNormal = "NORMAL"
	ModeDeep   = "DEEP"
)

// TaskState is the durable scan-job lifecycle. PENDING and the command API live
// in FastAPI+Postgres; the worker owns ADMITTED→RUNNING→terminal in Redis and
// mirrors transitions onto task_events + the reporting queue.
type TaskState string

const (
	StatePending   TaskState = "PENDING"
	StateAdmitted  TaskState = "ADMITTED"
	StateRunning   TaskState = "RUNNING"
	StateCompleted TaskState = "COMPLETED"
	StateFailed    TaskState = "FAILED"
	StateCancelled TaskState = "CANCELLED"
)

// StageStatus is a single stage's status within a running task.
type StageStatus string

const (
	StagePending   StageStatus = "PENDING"
	StageRunning   StageStatus = "RUNNING"
	StageCompleted StageStatus = "COMPLETED"
	StageFailed    StageStatus = "FAILED"
	StageSkipped   StageStatus = "SKIPPED"
	StageCancelled StageStatus = "CANCELLED"
)

// QueuesFor returns the three per-priority job queues for a service, e.g.
// asm.high, asm.medium, asm.low. Consumed by the worker, published to by Python.
func QueuesFor(service string) []string {
	return []string{
		service + "." + PriorityHigh,
		service + "." + PriorityMedium,
		service + "." + PriorityLow,
	}
}

// ---- Redis key schema (must match the Python side) ----

// SlotsKey is the global concurrency counter for a service (atomic acquire/release).
func SlotsKey(service string) string { return "slots:" + service }

// TaskKey holds the live task JSON ({status,current_stage,stages[],started_at}).
func TaskKey(taskID string) string { return "task:" + taskID }

// CancelKey is set by FastAPI to request cooperative cancellation.
func CancelKey(taskID string) string { return "task:" + taskID + ":cancel" }

// LeaseKey is a TTL heartbeat; the reaper requeues a task whose lease expired
// while it was RUNNING.
func LeaseKey(taskID string) string { return "task:" + taskID + ":lease" }

// EventsChannel is the per-org pub/sub channel the worker publishes stage/task
// events on; FastAPI SSE subscribes and streams to the UI.
func EventsChannel(orgID string) string { return "task_events:" + orgID }

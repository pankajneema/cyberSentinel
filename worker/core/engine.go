package core

import (
	"context"
	"fmt"
	"time"

	"worker/config"
	"worker/tools"
	"worker/utils"
)

// cfg is the engine's view of configuration, set once at boot via Configure.
var cfg *config.Config

// Configure injects the loaded config the engine needs (slot caps, lease TTL,
// heartbeat interval, per-task timeout). Call once from main before StartConsumer.
func Configure(c *config.Config) { cfg = c }

// admitAttempts bounds how long a handler waits for a slot before asking for
// redelivery, so a full service applies backpressure instead of failing tasks.
const admitAttempts = 3

// Run executes one job end to end: admit (Redis slot) → build pipeline → run
// each stage via the tool registry → mirror state to Redis + task_events →
// honor cancel → hand findings to the service → hand a terminal message to
// reporting. Returns ErrRequeue if it could not be admitted (transient), nil on
// a completed/cancelled task, or a non-nil error only for unexpected failures
// (which dead-letter the message).
func Run(ctx context.Context, svc Service, job Job) (err error) {
	service := svc.Name()
	max := cfg.MaxConcurrencyFor(service)

	// Admission: atomic Redis slot. Retry a few times, then requeue.
	admitted := false
	for i := 0; i < admitAttempts; i++ {
		ok, aerr := AcquireSlot(ctx, service, max)
		if aerr != nil {
			return fmt.Errorf("slot acquire failed: %w", aerr)
		}
		if ok {
			admitted = true
			break
		}
		time.Sleep(time.Second)
	}
	if !admitted {
		utils.Logger.Infof("%s at capacity (%d), requeueing task=%s", service, max, job.TaskID)
		return ErrRequeue
	}
	defer func() {
		if rerr := ReleaseSlot(context.Background(), service); rerr != nil {
			utils.Logger.Warnf("slot release failed (%s): %v", service, rerr)
		}
	}()

	// Build the live task from the service's stage list.
	stages := svc.Stages(job)
	for i := range stages {
		stages[i].Status = StagePending
	}
	task := &Task{
		TaskID:      job.TaskID,
		OrgID:       job.OrgID,
		AssetID:     job.AssetID,
		Service:     service,
		Status:      StateAdmitted,
		Stages:      stages,
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
		job:         job,
		accumulated: map[string]any{},
	}

	// Recover any panic in stage execution → FAIL the task cleanly.
	defer func() {
		if r := recover(); r != nil {
			utils.Logger.Errorf("panic running task=%s: %v", task.TaskID, r)
			task.Status = StateFailed
			_ = task.persist(context.Background())
			emitTask(context.Background(), task, 100)
			_ = ClearLease(context.Background(), task.TaskID)
			err = nil // panic already handled; ACK so it does not re-run
		}
	}()

	_ = task.persist(ctx)
	emitTask(ctx, task, 0)

	// Lease + heartbeat.
	leaseTTL := time.Duration(cfg.LeaseTTLSec) * time.Second
	_ = SetLease(ctx, task.TaskID, leaseTTL)
	stopHeartbeat := make(chan struct{})
	go heartbeat(task.TaskID, leaseTTL, time.Duration(cfg.HeartbeatSec)*time.Second, stopHeartbeat)
	defer close(stopHeartbeat)
	defer func() { _ = ClearLease(context.Background(), task.TaskID) }()

	// Per-task deadline.
	taskCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.TaskTimeoutSec)*time.Second)
	defer cancel()

	task.Status = StateRunning
	_ = task.persist(taskCtx)
	emitTask(taskCtx, task, 0)

	total := len(task.Stages)
	for i := range task.Stages {
		if IsCancelled(taskCtx, task.TaskID) {
			return finishCancelled(taskCtx, task, i)
		}
		stage := &task.Stages[i]
		stage.Status = StageRunning
		stage.StartedAt = time.Now().UTC().Format(time.RFC3339)
		task.CurrentStage = stage.Name
		_ = task.persist(taskCtx)
		emitStage(taskCtx, task, *stage, progress(i, total))

		runStage(taskCtx, svc, task, stage)

		stage.EndedAt = time.Now().UTC().Format(time.RFC3339)
		_ = task.persist(taskCtx)
		emitStage(taskCtx, task, *stage, progress(i+1, total))
	}

	// Use a fresh, undeadlined context for this final state transition (matching
	// the panic-recovery path above and finishCancelled's lease-clear): taskCtx
	// carries the per-task execution deadline, and when total stage time runs
	// right up against TASK_TIMEOUT_SECONDS, taskCtx can expire between the
	// stage loop finishing and this persist — silently dropping the Redis write
	// (error discarded) while leaving Status=RUNNING on record. The reaper later
	// finds that stale RUNNING state with no lease and "correctly" (by its own
	// logic) marks an already-successfully-completed task FAILED.
	finalCtx := context.Background()
	task.Status = StateCompleted
	_ = task.persist(finalCtx)
	emitTask(finalCtx, task, 100)
	publishTerminal(finalCtx, task)
	return nil
}

// runStage resolves the tool, runs it, records the outcome on the stage, feeds
// the output forward for later stages, and hands findings to the service. A
// missing tool is SKIPPED; a tool error is a soft FAIL (the pipeline continues).
func runStage(ctx context.Context, svc Service, task *Task, stage *Stage) {
	runner, ok := tools.Get(stage.Tool)
	if !ok {
		stage.Status = StageSkipped
		stage.Error = "tool not registered: " + stage.Tool
		return
	}
	in := tools.Input{
		JobID:   task.TaskID,
		AssetID: task.AssetID,
		Targets: task.job.Targets,
		Params: map[string]any{
			"mode":           task.job.Mode,
			"config":         task.job.Config,
			"org_id":         task.OrgID,
			"accumulated":    task.accumulated,
			"prior_findings": task.findings,
		},
	}
	out, rerr := runner.Run(ctx, in)
	if rerr != nil {
		stage.Status = StageFailed
		stage.Error = rerr.Error()
		utils.Logger.Warnf("stage %s (%s) failed on task=%s: %v", stage.Name, stage.Tool, task.TaskID, rerr)
		return
	}
	stage.Status = StageCompleted
	stage.Result = out.Raw
	task.accumulated[stage.Name] = out
	task.findings = append(task.findings, out.Findings...)
	if serr := svc.SaveFindings(ctx, task, *stage, out); serr != nil {
		utils.Logger.Warnf("SaveFindings failed for stage %s on task=%s: %v", stage.Name, task.TaskID, serr)
	}
}

// finishCancelled marks the remaining stages cancelled and the task CANCELLED.
func finishCancelled(ctx context.Context, task *Task, from int) error {
	for i := from; i < len(task.Stages); i++ {
		task.Stages[i].Status = StageCancelled
	}
	task.Status = StateCancelled
	_ = task.persist(ctx)
	emitTask(ctx, task, progress(from, len(task.Stages)))
	publishTerminal(ctx, task)
	_ = ClearCancel(ctx, task.TaskID)
	utils.Logger.Infof("task=%s cancelled at stage %d/%d", task.TaskID, from, len(task.Stages))
	return nil
}

// publishTerminal hands a terminal task summary to the reporting queue. Findings
// themselves are shipped per-stage by the service's SaveFindings; this is the
// "task is done" marker Python uses to finalize the run + notify.
//
// "targets" echoes the original job's target list (task.job.Targets — the plain
// host list every service is published with) so a consumer that ran cleanly and
// found nothing can still tell "we scanned N targets, 0 findings" apart from
// "nothing was ever dispatched". VS's reporting consumer (backend/reporting/
// vs/consumer.py) reads this to build its per-target "scanned" status instead of
// inferring it from findings, which was empty (and thus indistinguishable from
// an undispatched scan) whenever a real scan legitimately found nothing.
func publishTerminal(ctx context.Context, task *Task) {
	msg := map[string]any{
		"type":     task.Service,
		"kind":     "task_terminal",
		"task_id":  task.TaskID,
		"org_id":   task.OrgID,
		"asset_id": task.AssetID,
		"status":   string(task.Status),
		"stages":   task.Stages,
		"targets":  task.job.Targets,
		"config":   task.job.Config,
	}
	if err := PublishReport(ctx, task.Service, msg); err != nil {
		utils.Logger.Warnf("reporting publish failed for task=%s: %v", task.TaskID, err)
	}
}

// heartbeat renews the task lease until the task finishes.
func heartbeat(taskID string, ttl, every time.Duration, stop <-chan struct{}) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			_ = SetLease(context.Background(), taskID, ttl)
		}
	}
}

func progress(done, total int) int {
	if total <= 0 {
		return 100
	}
	return done * 100 / total
}

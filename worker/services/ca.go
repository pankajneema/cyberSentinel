package services

import (
	"context"

	"worker/core"
	"worker/tools"
)

// caService — Compliance & Audit. Structurally identical skeleton to asm.go and
// vs.go. CA has no external scanner: the single evaluation stage emits a request
// that SaveFindings forwards to reporting, where the Python CA engine
// (evaluate_org_isolated) does the actual control/evidence evaluation.

// 1) type
type caService struct{}

// 2) self-register
func init() { core.RegisterService(&caService{}) }

// 3) identity
func (s *caService) Name() string { return core.ServiceCA }

// 4) queues
func (s *caService) Queues() []string { return core.QueuesFor(core.ServiceCA) }

// 5) stages — one evaluation stage handed off to the Python CA engine.
func (s *caService) Stages(job core.Job) []core.Stage {
	return []core.Stage{{Name: "compliance_evaluation", Tool: "ca_evaluate"}}
}

// 6) persistence — forward the evaluation request to reporting; Python runs it.
func (s *caService) SaveFindings(ctx context.Context, task *core.Task, stage core.Stage, out tools.Output) error {
	if len(out.Findings) == 0 {
		return nil
	}
	return core.PublishReport(ctx, core.ServiceCA, map[string]any{
		"type":     core.ServiceCA,
		"kind":     "stage_findings",
		"task_id":  task.TaskID,
		"org_id":   task.OrgID,
		"asset_id": task.AssetID,
		"stage":    stage.Name,
		"tool":     stage.Tool,
		"findings": out.Findings,
	})
}

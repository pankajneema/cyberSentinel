package services

import (
	"context"

	"worker/core"
	"worker/tools"
)

// asmService — Attack Surface Management. Structurally identical skeleton to
// vs.go and ca.go; only the stage list and finding-save differ. Stages come from
// the ported PipelineConfig (asm_stages.go); SaveFindings ships each stage's
// findings to the reporting queue, where the Python consumer persists + scores.

// 1) type
type asmService struct{}

// 2) self-register
func init() { core.RegisterService(&asmService{}) }

// 3) identity
func (s *asmService) Name() string { return core.ServiceASM }

// 4) queues
func (s *asmService) Queues() []string { return core.QueuesFor(core.ServiceASM) }

// 5) stages — pick the pipeline by asset type (job.config.asset_type) and
// intensity (job.mode). Returns a fresh copy so the engine may mutate status.
func (s *asmService) Stages(job core.Job) []core.Stage {
	assetType := "domain"
	if v, ok := job.Config["asset_type"].(string); ok && v != "" {
		assetType = v
	}
	mode := job.Mode
	if mode == "" {
		mode = core.ModeNormal
	}
	byMode, ok := asmPipeline[assetType]
	if !ok {
		return nil
	}
	stages, ok := byMode[mode]
	if !ok {
		return nil
	}
	out := make([]core.Stage, len(stages))
	copy(out, stages)
	return out
}

// 6) persistence — hand this stage's findings to reporting (Python persists +
// scores). Incremental so the UI Findings tab is live.
func (s *asmService) SaveFindings(ctx context.Context, task *core.Task, stage core.Stage, out tools.Output) error {
	if len(out.Findings) == 0 {
		return nil
	}
	return core.PublishReport(ctx, core.ServiceASM, map[string]any{
		"type":     core.ServiceASM,
		"kind":     "stage_findings",
		"task_id":  task.TaskID,
		"org_id":   task.OrgID,
		"asset_id": task.AssetID,
		"stage":    stage.Name,
		"tool":     stage.Tool,
		"findings": out.Findings,
	})
}

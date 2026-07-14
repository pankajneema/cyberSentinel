package services

import (
	"context"

	"worker/core"
	"worker/tools"
)

// vsService — Vulnerability Scanning. Structurally identical skeleton to asm.go
// and ca.go; only the stage list and finding-save differ. Stages are the enabled
// engines (nuclei / sslyze / nmap_nse / default-login), each a registered vs_*
// tool that reuses the existing engine adapter body and threads the in-memory
// credential without ever serializing it. SaveFindings ships findings to the
// reporting queue for the Python consumer to map into vs_findings.

// 1) type
type vsService struct{}

// 2) self-register
func init() { core.RegisterService(&vsService{}) }

// 3) identity
func (s *vsService) Name() string { return core.ServiceVS }

// 4) queues
func (s *vsService) Queues() []string { return core.QueuesFor(core.ServiceVS) }

// 5) stages — one stage per enabled engine (job.config.engines); defaults to all.
func (s *vsService) Stages(job core.Job) []core.Stage {
	engines := vsEngines(job)
	var stages []core.Stage
	for _, e := range engines {
		if tool, ok := vsEngineTool[e]; ok {
			stages = append(stages, core.Stage{Name: e, Tool: tool})
		}
	}
	return stages
}

// 6) persistence — hand this stage's findings to reporting (Python maps to vs_findings).
func (s *vsService) SaveFindings(ctx context.Context, task *core.Task, stage core.Stage, out tools.Output) error {
	if len(out.Findings) == 0 {
		return nil
	}
	return core.PublishReport(ctx, core.ServiceVS, map[string]any{
		"type":     core.ServiceVS,
		"kind":     "stage_findings",
		"task_id":  task.TaskID,
		"org_id":   task.OrgID,
		"asset_id": task.AssetID,
		"stage":    stage.Name,
		"tool":     stage.Tool,
		"findings": out.Findings,
	})
}

// vsEngineTool maps a profile engine alias to its registered vs_* tool name.
var vsEngineTool = map[string]string{
	"nuclei":        "vs_nuclei",
	"sslyze":        "vs_sslyze",
	"sslscan":       "vs_sslyze",
	"nmap_nse":      "vs_nmap_nse",
	"nmap":          "vs_nmap_nse",
	"default-login": "vs_default_login",
	"weakcred":      "vs_default_login",
}

// vsEngines reads the enabled engines from job.config.engines, defaulting to the
// full set when unspecified.
func vsEngines(job core.Job) []string {
	if raw, ok := job.Config["engines"].([]any); ok && len(raw) > 0 {
		var out []string
		for _, e := range raw {
			if s, ok := e.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return []string{"nuclei", "sslyze", "nmap_nse", "default-login"}
}

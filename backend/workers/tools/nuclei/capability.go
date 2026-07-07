package nuclei

import (
	"context"

	"workers/tools"
)

// capability adapts nuclei to tools.Capability and self-registers under
// "nuclei". The ASM path still calls Run directly; pipelines resolve this via
// tools.Get("nuclei").
type capability struct{}

func (capability) Name() string { return "nuclei" }

func (capability) Run(ctx context.Context, in tools.Input) (tools.Output, error) {
	results, err := Run(ctx, in.Targets)
	if err != nil {
		return tools.Output{}, err
	}
	out := tools.Output{Raw: map[string]any{"findings": results}}
	for _, f := range results {
		out.Findings = append(out.Findings, tools.Finding{
			Type:     "vuln",
			Target:   f.Host,
			Name:     f.Name,
			Severity: f.Severity,
			Data: map[string]any{
				"template_id": f.TemplateID,
				"matched_at":  f.MatchedAt,
				"cves":        f.CVEs,
			},
		})
	}
	return out, nil
}

func init() { tools.Register(capability{}) }

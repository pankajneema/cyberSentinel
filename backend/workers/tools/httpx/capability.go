package httpx

import (
	"context"

	"workers/tools"
)

// capability adapts httpx to the shared tools.Capability interface and
// self-registers under "httpx". The ASM path still calls RunHTTPStatus directly;
// pipelines resolve this via tools.Get("httpx").
type capability struct{}

func (capability) Name() string { return "httpx" }

func (capability) Run(ctx context.Context, in tools.Input) (tools.Output, error) {
	responses, err := RunHTTPStatus(ctx, in.Targets)
	if err != nil {
		return tools.Output{}, err
	}
	out := tools.Output{Raw: map[string]any{"responses": responses}}
	for _, r := range responses {
		out.Findings = append(out.Findings, tools.Finding{
			Type:   "http",
			Target: r.URL,
			Name:   r.Title,
			Data: map[string]any{
				"status_code": r.StatusCode,
				"https":       r.HTTPS,
				"server":      r.Server,
			},
		})
	}
	return out, nil
}

func init() { tools.Register(capability{}) }

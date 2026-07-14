package tools

import (
	"context"

	"worker/tools/saasdetect"
)

func init() { Register(saasDetectTool{}) }

// saasDetectTool detects third-party SaaS applications used by each root domain
// via MX records and common SaaS-related subdomain resolution.
type saasDetectTool struct{}

func (saasDetectTool) Name() string { return "saas_detect" }

func (saasDetectTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	for _, domain := range roots(in) {
		apps, err := saasdetect.Run(ctx, domain)
		if err != nil {
			continue // best-effort per domain
		}
		for _, app := range apps {
			target, _ := app["url"].(string)
			if target == "" {
				if n, ok := app["app_name"].(string); ok {
					target = n
				}
			}
			name, _ := app["app_name"].(string)
			out.Findings = append(out.Findings, Finding{
				Type:   "saas",
				Target: target,
				Name:   name,
				Data:   app,
			})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

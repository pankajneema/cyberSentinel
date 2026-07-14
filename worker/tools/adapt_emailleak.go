package tools

import (
	"context"

	"worker/tools/emailleak"
)

func init() { Register(emailLeakTool{}) }

// ---- email_leak_check: HIBP breach lookup for seed domains/emails ----

type emailLeakTool struct{}

func (emailLeakTool) Name() string { return "email_leak_check" }

func (emailLeakTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	seen := map[string]bool{}
	for _, account := range roots(in) {
		breaches, err := emailleak.Run(ctx, account)
		if err != nil {
			continue // best-effort per account
		}
		for _, b := range breaches {
			target := account
			if e, ok := b["email"].(string); ok && e != "" {
				target = e
			}
			name, _ := b["source"].(string)
			sev, _ := b["severity"].(string)
			key := target + "|" + name
			if seen[key] {
				continue
			}
			seen[key] = true
			out.Findings = append(out.Findings, Finding{
				Type: "email_leak", Target: target, Name: name, Severity: sev,
				Data: b,
			})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

package tools

import "context"

// CA (Compliance & Audit) tool. Unlike ASM/VS, CA runs no external scanner: its
// evaluation is pure Postgres + the Python CA engine (ca/engine.py). The worker
// therefore only owns the CA task lifecycle (admit / state / events / reporting
// hand-off); the ca_evaluate stage emits a single request marker that the Python
// reporting consumer turns into an evaluate_org_isolated run. This keeps
// execution in Go and compliance domain logic in Python.

type caEvaluateTool struct{}

func (caEvaluateTool) Name() string { return "ca_evaluate" }

func (caEvaluateTool) Run(ctx context.Context, in Input) (Output, error) {
	c := vsConfig(in) // generic: reads Params["config"]
	req := map[string]any{
		"org_id": str(in.Params["org_id"]),
		"scope":  str(c["scope"]),
	}
	if fw, ok := c["framework_ids"].([]any); ok {
		req["framework_ids"] = fw
	}
	return Output{
		Findings: []Finding{{Type: "ca_eval_request", Target: str(in.Params["org_id"]), Data: req}},
		Raw:      map[string]any{"requested": true},
	}, nil
}

func init() { Register(caEvaluateTool{}) }

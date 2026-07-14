package tools

import (
	"context"

	"worker/tools/gobuster"
)

func init() {
	Register(gobusterTool{})
}

// ---- gobuster (admin_finder): discover admin endpoints over http hosts ----

type gobusterTool struct{}

func (gobusterTool) Name() string { return "admin_finder" }

func (gobusterTool) Run(ctx context.Context, in Input) (Output, error) {
	hosts := Subjects(in, TypeHTTP)
	if len(hosts) == 0 {
		hosts = subdomains(in)
	}
	endpoints, err := gobuster.RunAdminFinder(ctx, hosts)
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"count": len(endpoints)}}
	for _, e := range endpoints {
		out.Findings = append(out.Findings, Finding{
			Type: "endpoint", Target: e.URL, Name: "admin",
			Data: map[string]any{"status": e.Status, "size": e.Size},
		})
	}
	return out, nil
}

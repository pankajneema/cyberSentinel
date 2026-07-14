package tools

import (
	"context"

	"worker/tools/naabu"
)

func init() {
	Register(naabuTool{})
}

// ---- naabu: fast top-ports scan over discovered IPs ----

type naabuTool struct{}

func (naabuTool) Name() string { return "top_ports_scanner" }

func (naabuTool) Run(ctx context.Context, in Input) (Output, error) {
	hosts := Subjects(in, TypeIP)
	if len(hosts) == 0 {
		hosts = subdomains(in)
	}
	results, err := naabu.RunTopPortsScan(ctx, hosts)
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"count": len(results)}}
	for _, r := range results {
		out.Findings = append(out.Findings, Finding{
			Type:   "port",
			Target: r.IP,
			Data:   map[string]any{"port": r.Port, "protocol": r.Protocol},
		})
	}
	return out, nil
}

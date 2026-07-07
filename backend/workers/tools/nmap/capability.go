package nmap

import (
	"context"

	"workers/tools"
)

// capability adapts nmap service detection to tools.Capability and
// self-registers under "nmap". Ports may be supplied via in.Params["ports"]
// ([]int); when absent nmap falls back to its default port range.
type capability struct{}

func (capability) Name() string { return "nmap" }

func (capability) Run(ctx context.Context, in tools.Input) (tools.Output, error) {
	var ports []int
	if p, ok := in.Params["ports"].([]int); ok {
		ports = p
	}
	results, err := RunServiceDetection(ctx, in.Targets, ports)
	if err != nil {
		return tools.Output{}, err
	}
	out := tools.Output{Raw: map[string]any{"services": results}}
	for _, r := range results {
		out.Findings = append(out.Findings, tools.Finding{
			Type:   "service",
			Target: r.IP,
			Name:   r.Service,
			Data: map[string]any{
				"port":    r.Port,
				"version": r.Version,
				"product": r.Product,
			},
		})
	}
	return out, nil
}

func init() { tools.Register(capability{}) }

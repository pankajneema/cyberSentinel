package tools

import (
	"context"

	"worker/tools/nmap"
)

// nmap service-detection adapters. Registered under both "service_detector" and
// "nmap" via two thin structs sharing runNmapServiceDetection. Input IPs come
// from prior TypeIP findings (fallback to discovered subdomains); ports come
// from prior "port" findings' Data["port"] (empty → nmap's default range).
func init() {
	Register(nmapServiceTool{})
	Register(nmapTool{})
}

type nmapServiceTool struct{}

func (nmapServiceTool) Name() string { return "service_detector" }

func (nmapServiceTool) Run(ctx context.Context, in Input) (Output, error) {
	return runNmapServiceDetection(ctx, in)
}

type nmapTool struct{}

func (nmapTool) Name() string { return "nmap" }

func (nmapTool) Run(ctx context.Context, in Input) (Output, error) {
	return runNmapServiceDetection(ctx, in)
}

// runNmapServiceDetection wires prior findings into nmap.RunServiceDetection and
// emits one "service" finding per discovered service.
func runNmapServiceDetection(ctx context.Context, in Input) (Output, error) {
	ips := Subjects(in, TypeIP)
	if len(ips) == 0 {
		ips = subdomains(in)
	}

	ports := priorPorts(in)

	results, err := nmap.RunServiceDetection(ctx, ips, ports)
	if err != nil {
		return Output{}, err
	}

	out := Output{Raw: map[string]any{"count": len(results)}}
	for _, r := range results {
		out.Findings = append(out.Findings, Finding{
			Type:   "service",
			Target: r.IP,
			Name:   r.Service,
			Data: map[string]any{
				"port":    r.Port,
				"service": r.Service,
				"version": r.Version,
				"product": r.Product,
			},
		})
	}
	return out, nil
}

// priorPorts collects deduped port numbers from prior "port" findings, reading
// Data["port"] which may arrive as int or float64 (JSON round-trip).
func priorPorts(in Input) []int {
	seen := map[int]bool{}
	var ports []int
	for _, f := range PriorFindings(in) {
		if f.Type != "port" {
			continue
		}
		p := 0
		switch v := f.Data["port"].(type) {
		case int:
			p = v
		case int64:
			p = int(v)
		case float64:
			p = int(v)
		}
		if p > 0 && !seen[p] {
			seen[p] = true
			ports = append(ports, p)
		}
	}
	return ports
}

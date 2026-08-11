package tools

import (
	"context"

	"worker/tools/cloudenum"
	"worker/utils"
)

// cloudenum adapters: discover exposed cloud resources / public endpoints over
// the seed root domains (used as keywords). Both register the same enumeration
// under two tool names the PipelineConfig may reference.

func init() {
	Register(cloudOsintTool{})
	Register(publicEndpointTool{})
}

// runCloudEnum enumerates cloud resources for every seed root and emits one
// "cloud" finding per discovered resource. Shared by both adapters.
func runCloudEnum(ctx context.Context, in Input, source string) (Output, error) {
	out := Output{Raw: map[string]any{}}
	seen := map[string]bool{}
	for _, d := range roots(in) {
		resources, err := cloudenum.RunCloudOSINT(ctx, d)
		if err != nil {
			utils.Logger.Warnf("cloud enum for root %q failed (best-effort, continuing): %v", d, err)
			continue // best-effort per root; a single failure isn't fatal
		}
		for _, r := range resources {
			if r.Name == "" || seen[r.Name] {
				continue
			}
			seen[r.Name] = true
			out.Findings = append(out.Findings, Finding{
				Type:   "cloud",
				Target: r.Name,
				Name:   r.Type,
				Data: map[string]any{
					"provider": r.Service,
					"type":     r.Type,
					"exposure": r.Status,
					"keyword":  d,
					"source":   source,
				},
			})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- cloud_osint: cloud resource enumeration ----

type cloudOsintTool struct{}

func (cloudOsintTool) Name() string { return "cloud_osint" }

func (cloudOsintTool) Run(ctx context.Context, in Input) (Output, error) {
	return runCloudEnum(ctx, in, "cloud_osint")
}

// ---- public_endpoint_detect: same enumeration, exposed-endpoint framing ----

type publicEndpointTool struct{}

func (publicEndpointTool) Name() string { return "public_endpoint_detect" }

func (publicEndpointTool) Run(ctx context.Context, in Input) (Output, error) {
	return runCloudEnum(ctx, in, "public_endpoint_detect")
}

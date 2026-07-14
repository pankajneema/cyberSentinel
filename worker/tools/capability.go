// Package tools is the shared home for every tool wrapper and AI capability.
// Each wrapper implements Capability and self-registers by name, so pipelines
// resolve a stage's tool via tools.Get(name) instead of a giant import block or
// switch. Recon CLIs and future AI services plug in through the same interface.
package tools

import "context"

// Input is the generic per-stage input handed to a capability.
type Input struct {
	JobID   string
	AssetID string
	Targets []string
	Params  map[string]any
}

// Finding is a normalized result produced by a capability. Tool-specific detail
// that does not fit these fields is carried in Raw on the Output.
type Finding struct {
	Type     string         `json:"type"`
	Target   string         `json:"target"`
	Name     string         `json:"name,omitempty"`
	Severity string         `json:"severity,omitempty"`
	Data     map[string]any `json:"data,omitempty"`
}

// Output is the generic per-stage output returned by a capability.
type Output struct {
	Findings []Finding
	Raw      map[string]any
}

// Capability is the single interface every tool wrapper and AI service
// implements.
type Capability interface {
	Name() string
	Run(ctx context.Context, in Input) (Output, error)
}

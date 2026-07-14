package core

import (
	"context"
	"sort"

	"worker/tools"
)

// Service is the ONLY thing the engine depends on. A service answers what stages
// to run (in what order) and how to hand a stage's findings off for persistence.
// The engine owns everything else: consume, admit, run loop, Redis state, events,
// cancel, reporting hand-off. All three service files (asm.go, vs.go, ca.go)
// implement this identical method set — only the bodies differ.
type Service interface {
	Name() string           // "asm" | "vs" | "ca"
	Queues() []string       // e.g. asm.high, asm.medium, asm.low
	Stages(job Job) []Stage // choose stage list by mode / asset-type
	SaveFindings(ctx context.Context, task *Task, stage Stage, out tools.Output) error
}

var registry = map[string]Service{}

// RegisterService wires a service by its Name(). Called once per service in init().
func RegisterService(s Service) { registry[s.Name()] = s }

// ServiceFor resolves the service that owns a job "type".
func ServiceFor(t string) (Service, bool) { s, ok := registry[t]; return s, ok }

// AllQueues is the de-duplicated, sorted set of job queues across every
// registered service — the queues the consumer subscribes to.
func AllQueues() []string {
	set := map[string]struct{}{}
	for _, s := range registry {
		for _, q := range s.Queues() {
			set[q] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for q := range set {
		out = append(out, q)
	}
	sort.Strings(out)
	return out
}

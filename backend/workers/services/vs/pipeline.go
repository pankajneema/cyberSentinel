// Package vs handles Vulnerability Scanning (VS) jobs consumed from jobs.vs.
//
// Like the ASM path, VS jobs run IN-PROCESS: each target is scanned by every
// enabled engine adapter and a single normalized result message is published to
// report.vs for the reporting consumer to persist. This file holds the stage
// engine: the Scanner contract and the per-target scan loop. Individual engines
// live in the *_adapter.go flow files; which engines participate is declared in
// pipeline_config.go.
package vs

import "context"

// Scanner is a pluggable vulnerability-scanning engine (one VS "stage").
type Scanner interface {
	// Name is the stable engine identifier (e.g. "nuclei").
	Name() string
	// Enabled reports whether this scanner should run for the given profile.
	Enabled(p Profile) bool
	// Scan runs the engine against a single target and returns normalized
	// findings. Implementations MUST honor ctx cancellation/timeout and MUST
	// return gracefully (empty result + error) when their backing binary is
	// absent — never panic.
	Scan(ctx context.Context, t Target, p Profile) ([]RawFinding, error)
}

// scanTarget runs every enabled scanner against one target. Each adapter runs
// under its own recover() (see executor.runAdapter) so a panicking/erroring
// engine cannot abort the target (or the job). Returns an error only if at
// least one enabled engine failed AND produced no findings — enough to mark the
// target "error".
func scanTarget(ctx context.Context, scanners []Scanner, target Target, profile Profile, scanRunID string) (findings []RawFinding, retErr error) {
	for _, s := range scanners {
		if !s.Enabled(profile) {
			continue
		}
		engineFindings, engineErr := runAdapter(ctx, s, target, profile, scanRunID)
		if engineErr != nil {
			// Record the first error; keep scanning other engines.
			if retErr == nil {
				retErr = engineErr
			}
			continue
		}
		findings = append(findings, engineFindings...)
	}
	return findings, retErr
}

// engineVersions best-effort collects a version string per enabled engine.
func engineVersions(ctx context.Context, scanners []Scanner, profile Profile) map[string]string {
	versions := map[string]string{}
	for _, s := range scanners {
		if !s.Enabled(profile) {
			continue
		}
		versions[s.Name()] = EngineVersion(ctx, s.Name())
	}
	return versions
}

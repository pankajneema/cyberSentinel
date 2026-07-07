package vs

import (
	"context"

	"workers/tools/nuclei"
)

// Registry returns all known VS scanner engines in the order they run. This is
// the VS analogue of the ASM PipelineConfig stage→tool map: it declares which
// engines participate in a scan. Add new engines here.
func Registry() []Scanner {
	return []Scanner{
		&NucleiAdapter{},
		&SslyzeAdapter{},
		&NmapNSEAdapter{},
		&DefaultLoginAdapter{},
	}
}

// EngineVersion returns a best-effort version string for the named engine, or
// "unknown" if it cannot be determined (e.g. binary missing).
func EngineVersion(ctx context.Context, name string) string {
	switch name {
	case "nuclei", "default-login":
		// default-login is driven by the nuclei engine (template class), so its
		// version is the nuclei binary version.
		return nuclei.Version(ctx)
	default:
		return "unknown"
	}
}

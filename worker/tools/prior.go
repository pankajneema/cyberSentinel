package tools

// Cross-stage data flow. The engine threads every completed stage's findings
// into the next stage's Input via Params["prior_findings"]. Tools consume what
// they need by finding Type — so a pipeline chains (subdomain → resolution/ip →
// reachable → http → vuln) without any tool hard-coding which stage ran before it.

// Finding Type vocabulary shared by ASM tool adapters.
const (
	TypeSubdomain  = "subdomain"
	TypeResolution = "resolution"
	TypeIP         = "ip"
	TypeReachable  = "reachable"
	TypeHTTP       = "http"
	TypeVuln       = "vuln"
)

// PriorFindings returns the flat list of findings produced by earlier stages.
func PriorFindings(in Input) []Finding {
	if v, ok := in.Params["prior_findings"]; ok {
		if f, ok := v.([]Finding); ok {
			return f
		}
	}
	return nil
}

// Subjects returns the deduped Targets of prior findings of the given type.
func Subjects(in Input, typ string) []string {
	seen := map[string]bool{}
	var out []string
	for _, f := range PriorFindings(in) {
		if f.Type == typ && f.Target != "" && !seen[f.Target] {
			seen[f.Target] = true
			out = append(out, f.Target)
		}
	}
	return out
}

// dedupeAppend unions two string slices, preserving order and dropping blanks/dupes.
func dedupeAppend(dst, src []string) []string {
	seen := map[string]bool{}
	for _, s := range dst {
		seen[s] = true
	}
	for _, s := range src {
		if s != "" && !seen[s] {
			seen[s] = true
			dst = append(dst, s)
		}
	}
	return dst
}

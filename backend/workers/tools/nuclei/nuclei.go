package nuclei

import (
	"bufio"
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"

	"workers/utils"
)

type Finding struct {
	Host       string `json:"host"`
	MatchedAt  string `json:"matched_at,omitempty"`
	TemplateID string `json:"template_id,omitempty"`
	Name       string `json:"name,omitempty"`
	Severity   string `json:"severity,omitempty"`

	// Extended fields (used by the VS worker path). These are populated from the
	// same nuclei JSONL output and are additive — existing ASM callers that only
	// read the fields above are unaffected.
	Description      string   `json:"description,omitempty"`
	Type             string   `json:"type,omitempty"` // http | network | dns | ...
	Port             string   `json:"port,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	MatcherName      string   `json:"matcher_name,omitempty"`
	ExtractedResults []string `json:"extracted_results,omitempty"`
	CVEs             []string `json:"cves,omitempty"`
	CVSSBase         float64  `json:"cvss_base,omitempty"`
}

// Version returns the installed nuclei version string, or "unknown" if the
// binary is missing or does not report a parseable version. Best-effort only.
func Version(ctx context.Context) string {
	toolPath, err := utils.LookPath("nuclei")
	if err != nil {
		return "unknown"
	}
	out, err := exec.CommandContext(ctx, toolPath, "-version").CombinedOutput()
	if err != nil {
		return "unknown"
	}
	// nuclei prints e.g. "[INF] Nuclei Engine Version: v3.3.0" to stderr/stdout.
	for _, line := range strings.Split(string(out), "\n") {
		l := strings.TrimSpace(line)
		if idx := strings.LastIndex(strings.ToLower(l), "version:"); idx >= 0 {
			v := strings.TrimSpace(l[idx+len("version:"):])
			if v != "" {
				return v
			}
		}
	}
	v := strings.TrimSpace(string(out))
	if v == "" {
		return "unknown"
	}
	return v
}

// toStringSlice coerces a nuclei JSON value that may be a []interface{} of
// strings or a single comma/space-separated string into a []string.
func toStringSlice(v interface{}) []string {
	switch t := v.(type) {
	case []interface{}:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		if t == "" {
			return nil
		}
		fields := strings.FieldsFunc(t, func(r rune) bool { return r == ',' || r == ' ' })
		out := make([]string, 0, len(fields))
		for _, f := range fields {
			if f = strings.TrimSpace(f); f != "" {
				out = append(out, f)
			}
		}
		return out
	default:
		return nil
	}
}

// Run scans the provided hosts with nuclei and returns parsed findings.
//
// This is the original, unchanged entrypoint used by the ASM path. It runs no
// custom headers; see RunWithHeaders for the authenticated VS path.
func Run(ctx context.Context, hosts []string) ([]Finding, error) {
	return RunWithHeaders(ctx, hosts, nil)
}

// RunWithHeaders scans the provided hosts with nuclei, additionally passing each
// entry of extraHeaders to the engine as a `-H "Key: Value"` custom header. It
// is used by the authenticated VS scan path to inject e.g. an Authorization
// header. When extraHeaders is empty the argv is identical to the ASM path, so
// existing callers via Run are unaffected.
//
// SECURITY: header values may contain a secret. This function MUST NOT log them
// (it does not) — the values are passed to exec argv only.
//
// It delegates to RunWithOptions with no exclude/include-tags, so behavior is unchanged.
func RunWithHeaders(ctx context.Context, hosts []string, extraHeaders []string) ([]Finding, error) {
	return RunWithOptions(ctx, hosts, extraHeaders, nil, nil, 0)
}

// RunWithOptions scans the provided hosts with nuclei. In addition to the
// authenticated-scan headers of RunWithHeaders, it accepts excludeTags: when
// non-empty, the engine is invoked with `-etags "<comma-joined-tags>"` so that
// templates carrying any of those tags are NEVER executed against the target
// (engine-level exclusion). This is what the VS SafeMode path uses to prevent
// intrusive/dos/fuzzing templates from running, rather than filtering their
// results after the fact.
//
// When BOTH extraHeaders and excludeTags are empty/nil the argv is byte-identical
// to the original ASM Run() path, so existing ASM callers are unaffected.
//
// SECURITY: header values may contain a secret. This function MUST NOT log them
// (it does not) — the values are passed to exec argv only.
//
// UNVERIFIED — the exact nuclei `-etags` behavior and tag names depend on the
// installed nuclei binary/template set and need runtime confirmation.
func RunWithOptions(ctx context.Context, hosts []string, extraHeaders []string, excludeTags []string, includeTags []string, rateLimit int) ([]Finding, error) {
	if len(hosts) == 0 {
		return nil, nil
	}

	toolPath, err := utils.LookPath("nuclei")
	if err != nil {
		return nil, err
	}

	args := []string{"-silent", "-jsonl", "-duc", "-list", "-"}
	for _, h := range extraHeaders {
		if h = strings.TrimSpace(h); h != "" {
			args = append(args, "-H", h)
		}
	}
	// Engine-level exclusion of intrusive template classes (VS SafeMode). Only
	// appended when at least one non-empty tag is provided, keeping the ASM argv
	// byte-identical when excludeTags is nil/empty.
	cleanTags := make([]string, 0, len(excludeTags))
	for _, t := range excludeTags {
		if t = strings.TrimSpace(t); t != "" {
			cleanTags = append(cleanTags, t)
		}
	}
	if len(cleanTags) > 0 {
		args = append(args, "-etags", strings.Join(cleanTags, ","))
	}
	// Engine-level INCLUSION: run ONLY templates carrying one of these tags
	// (`-tags`). Used by the default-login/weak-credential adapter to scope the
	// scan to nuclei's default-login template class. Kept nil for ASM and the
	// generic VS nuclei path, so their argv stays byte-identical.
	inclTags := make([]string, 0, len(includeTags))
	for _, t := range includeTags {
		if t = strings.TrimSpace(t); t != "" {
			inclTags = append(inclTags, t)
		}
	}
	if len(inclTags) > 0 {
		args = append(args, "-tags", strings.Join(inclTags, ","))
	}
	// Engine-level rate limiting (requests/sec) to protect the target from DoS.
	if rateLimit > 0 {
		args = append(args, "-rl", strconv.Itoa(rateLimit))
	}

	cmd := exec.CommandContext(ctx, toolPath, args...)
	cmd.Stdin = strings.NewReader(strings.Join(hosts, "\n"))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	var findings []Finding
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			continue
		}

		finding := Finding{}
		if host, ok := payload["host"].(string); ok {
			finding.Host = host
		}
		if matchedAt, ok := payload["matched-at"].(string); ok {
			finding.MatchedAt = matchedAt
		}
		if templateID, ok := payload["template-id"].(string); ok {
			finding.TemplateID = templateID
		}
		if t, ok := payload["type"].(string); ok {
			finding.Type = t
		}
		if p, ok := payload["port"].(string); ok {
			finding.Port = p
		}
		if mn, ok := payload["matcher-name"].(string); ok {
			finding.MatcherName = mn
		}
		if er, ok := payload["extracted-results"]; ok {
			finding.ExtractedResults = toStringSlice(er)
		}
		if info, ok := payload["info"].(map[string]interface{}); ok {
			if name, ok := info["name"].(string); ok {
				finding.Name = name
			}
			if severity, ok := info["severity"].(string); ok {
				finding.Severity = severity
			}
			if desc, ok := info["description"].(string); ok {
				finding.Description = desc
			}
			if tags, ok := info["tags"]; ok {
				finding.Tags = toStringSlice(tags)
			}
			if cls, ok := info["classification"].(map[string]interface{}); ok {
				if cve, ok := cls["cve-id"]; ok {
					finding.CVEs = toStringSlice(cve)
				}
				switch score := cls["cvss-score"].(type) {
				case float64:
					finding.CVSSBase = score
				case string:
					// leave as 0 if unparseable
					if f, err := strconv.ParseFloat(strings.TrimSpace(score), 64); err == nil {
						finding.CVSSBase = f
					}
				}
			}
		}
		findings = append(findings, finding)
	}

	// A benign non-zero nuclei exit (e.g. a template erroring) is tolerated when
	// we still parsed findings. But a cancelled/timed-out context is NOT benign:
	// the scan was truncated, so surface the error even with partial findings —
	// otherwise the caller records an incomplete scan as complete (violating the
	// Scanner "MUST honor ctx cancellation/timeout" contract). Same rationale for
	// a scanner read error (e.g. an oversized line) that halted parsing early.
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return findings, ctx.Err()
	}
	if err := scanner.Err(); err != nil {
		return findings, err
	}
	if waitErr != nil && len(findings) == 0 {
		return nil, waitErr
	}
	return findings, nil
}

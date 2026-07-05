package vs

import (
	"context"
	"encoding/base64"
	"strings"

	"workers/executor/tools/nuclei"
)

// NucleiAdapter implements Scanner by driving the shared nuclei tool wrapper
// (executor/tools/nuclei) — the same binary/argv path ASM uses — and mapping
// each nuclei result into a normalized RawFinding.
type NucleiAdapter struct{}

// Name implements Scanner.
func (a *NucleiAdapter) Name() string { return "nuclei" }

// Enabled implements Scanner: nuclei runs when "nuclei" is in the profile's
// engine list (case-insensitive).
func (a *NucleiAdapter) Enabled(p Profile) bool {
	for _, e := range p.Engines {
		if strings.EqualFold(strings.TrimSpace(e), "nuclei") {
			return true
		}
	}
	return false
}

// safeModeExcludeTags are the nuclei template tags excluded at the ENGINE when
// the profile requests SafeMode. Passed to the wrapper as `-etags` so matching
// templates are never executed against the target (not merely filtered from the
// report). These are real nuclei tag names.
//
// UNVERIFIED — exact tag coverage depends on the installed nuclei binary and
// template set; needs runtime confirmation.
var safeModeExcludeTags = []string{"dos", "intrusive", "fuzzing"}

// intrusiveTags are template tags we additionally drop from results when the
// profile requests SafeMode. With engine-level `-etags` exclusion now in place
// this post-filter is retained only as harmless defense-in-depth (e.g. should a
// template be tagged differently than the engine excludes).
var intrusiveTags = map[string]bool{
	"dos":       true,
	"intrusive": true,
	"fuzz":      true,
	"fuzzing":   true,
}

// Scan implements Scanner. It scans the target's host/URL with nuclei and maps
// each result to a RawFinding. A missing nuclei binary yields (nil, error)
// rather than a panic (the wrapper's getToolPath returns an error).
func (a *NucleiAdapter) Scan(ctx context.Context, t Target, p Profile) ([]RawFinding, error) {
	target := strings.TrimSpace(t.URL)
	if target == "" {
		target = strings.TrimSpace(t.Host)
	}
	if target == "" {
		return nil, nil
	}

	// Build optional authenticated-scan headers from the profile credential.
	// SECURITY: the header value may embed a secret; it is passed to the wrapper
	// argv only and is NEVER logged here or downstream.
	extraHeaders := authHeaders(p.Credential)

	// SafeMode excludes intrusive template classes at the ENGINE via `-etags`,
	// so those templates are never executed against the target. When SafeMode is
	// off we pass nil (no exclusion — unchanged behavior).
	var excludeTags []string
	if p.SafeMode {
		excludeTags = safeModeExcludeTags
	}

	// Reuse the ASM nuclei wrapper (parameterized argv, ctx-bound). When no
	// credential is present extraHeaders is nil, and when SafeMode is off
	// excludeTags is nil, so the argv is identical to the ASM path.
	results, err := nuclei.RunWithOptions(ctx, []string{target}, extraHeaders, excludeTags, nil, p.MaxRPS)
	if err != nil {
		return nil, err
	}

	findings := make([]RawFinding, 0, len(results))
	for _, r := range results {
		if p.SafeMode && hasIntrusiveTag(r.Tags) {
			continue
		}

		location := map[string]any{}
		if r.MatchedAt != "" {
			location["url"] = r.MatchedAt
		}
		if r.Host != "" {
			location["host"] = r.Host
		}
		if r.Port != "" {
			location["port"] = r.Port
		}
		if r.Type != "" {
			location["type"] = r.Type
		}
		location["asset_id"] = t.AssetID

		findings = append(findings, RawFinding{
			AssetID:      t.AssetID,
			SourceEngine: a.Name(),
			PluginID:     r.TemplateID,
			Title:        r.Name,
			Description:  r.Description,
			Category:     deriveCategory(r.CVEs, r.Tags),
			Severity:     normalizeSeverity(r.Severity),
			Evidence:     buildEvidence(r.MatcherName, r.ExtractedResults),
			Confidence:   "firm",
			CVEs:         normalizeCVEs(r.CVEs),
			CVSSBase:     r.CVSSBase,
			Location:     location,
		})
	}

	return findings, nil
}

// authHeaders converts a resolved Credential into nuclei `-H` header strings.
//
// Supported types:
//   - bearer:     Authorization: Bearer <secret>
//   - http_basic: Authorization: Basic base64(username:secret)
//
// Other types (http_form, ssh) cannot be expressed as a static HTTP header and
// are skipped (returns nil) — the scan proceeds unauthenticated for nuclei.
//
// SECURITY: the returned strings contain the secret; callers MUST NOT log them.
func authHeaders(c *Credential) []string {
	if c == nil {
		return nil
	}
	switch strings.ToLower(strings.TrimSpace(c.Type)) {
	case "bearer":
		if c.Secret == "" {
			return nil
		}
		return []string{"Authorization: Bearer " + c.Secret}
	case "http_basic":
		if c.Secret == "" {
			return nil
		}
		token := base64.StdEncoding.EncodeToString([]byte(c.Username + ":" + c.Secret))
		return []string{"Authorization: Basic " + token}
	default:
		return nil
	}
}

func hasIntrusiveTag(tags []string) bool {
	for _, tag := range tags {
		if intrusiveTags[strings.ToLower(strings.TrimSpace(tag))] {
			return true
		}
	}
	return false
}

// deriveCategory: cve_match when CVEs are present, otherwise infer from tags
// (misconfig vs exposure), defaulting to "exposure".
func deriveCategory(cves []string, tags []string) string {
	if len(cves) > 0 {
		return "cve_match"
	}
	for _, tag := range tags {
		switch strings.ToLower(strings.TrimSpace(tag)) {
		case "misconfig", "misconfiguration", "config":
			return "misconfig"
		case "exposure", "exposures", "disclosure":
			return "exposure"
		}
	}
	return "exposure"
}

func normalizeSeverity(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "critical", "high", "medium", "low", "info":
		return s
	case "":
		return "info"
	default:
		return s
	}
}

func normalizeCVEs(cves []string) []string {
	if len(cves) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(cves))
	for _, c := range cves {
		if c = strings.TrimSpace(c); c != "" {
			out = append(out, strings.ToUpper(c))
		}
	}
	return out
}

func buildEvidence(matcherName string, extracted []string) string {
	parts := make([]string, 0, 2)
	if matcherName != "" {
		parts = append(parts, "matcher="+matcherName)
	}
	if len(extracted) > 0 {
		parts = append(parts, "extracted="+strings.Join(extracted, ", "))
	}
	return strings.Join(parts, "; ")
}

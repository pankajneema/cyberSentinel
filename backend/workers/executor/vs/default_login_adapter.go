package vs

import (
	"context"
	"strings"

	"workers/executor/tools/nuclei"
)

// DefaultLoginAdapter implements Scanner by driving nuclei's default-login
// template class (`-tags default-login`) against a target and normalizing each
// match into a "weak_credential" RawFinding.
//
// DESIGN: this is a *known-default-credential* check, NOT a brute-force / wordlist
// credential-spray. nuclei's default-login templates each attempt a single, known
// vendor-default pair against the specific service they fingerprint (e.g.
// admin/admin on a known appliance). This is how commercial scanners ship a
// "default credentials" plugin: high-signal, low-request, and — unlike a spray —
// no account-lockout or DoS risk. SafeMode exclusions and the per-scan rate limit
// (MaxRPS) still apply at the engine.
type DefaultLoginAdapter struct{}

// defaultLoginIncludeTags scopes the nuclei run to only the default-login
// template class via `-tags`. UNVERIFIED — the exact tag name depends on the
// installed nuclei template set and needs runtime confirmation.
var defaultLoginIncludeTags = []string{"default-login"}

// Name implements Scanner.
func (a *DefaultLoginAdapter) Name() string { return "default-login" }

// Enabled implements Scanner: runs when "default-login" is in the profile's
// engine list (case-insensitive). "weakcred" is accepted as an alias.
func (a *DefaultLoginAdapter) Enabled(p Profile) bool {
	for _, e := range p.Engines {
		e = strings.ToLower(strings.TrimSpace(e))
		if e == "default-login" || e == "weakcred" {
			return true
		}
	}
	return false
}

// Scan implements Scanner. It runs nuclei restricted to the default-login
// template class and maps each match to a weak_credential RawFinding. A missing
// nuclei binary yields (nil, error) rather than a panic.
func (a *DefaultLoginAdapter) Scan(ctx context.Context, t Target, p Profile) ([]RawFinding, error) {
	target := strings.TrimSpace(t.URL)
	if target == "" {
		target = strings.TrimSpace(t.Host)
	}
	if target == "" {
		return nil, nil
	}

	// Optional authenticated-scan headers (rare for default-login, but a target
	// behind an auth proxy may still need them). The secret is passed to argv
	// only and NEVER logged. Reuses authHeaders from nuclei_adapter.go.
	extraHeaders := authHeaders(p.Credential)

	// SafeMode still excludes intrusive classes at the engine; default-login
	// templates are single-request checks and are not themselves intrusive.
	var excludeTags []string
	if p.SafeMode {
		excludeTags = safeModeExcludeTags
	}

	results, err := nuclei.RunWithOptions(ctx, []string{target}, extraHeaders,
		excludeTags, defaultLoginIncludeTags, p.MaxRPS)
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

		// Severity: a working default credential is serious. Honor the template's
		// severity but floor to "high" so a template that under-rates (e.g. "info"
		// or unset) does not bury a live default-credential finding.
		severity := floorSeverity(normalizeSeverity(r.Severity), "high")

		findings = append(findings, RawFinding{
			AssetID:      t.AssetID,
			SourceEngine: a.Name(),
			PluginID:     r.TemplateID,
			Title:        r.Name,
			Description:  r.Description,
			Category:     "weak_credential",
			Severity:     severity,
			Evidence:     buildEvidence(r.MatcherName, r.ExtractedResults),
			// A default-login template match means the credential actually
			// authenticated — this is a confirmed, not tentative, finding.
			Confidence: "confirmed",
			CVEs:       normalizeCVEs(r.CVEs),
			CVSSBase:   r.CVSSBase,
			Location:   location,
		})
	}

	return findings, nil
}

// floorSeverity returns the more severe of `sev` and `floor` (critical>high>
// medium>low>info). Unknown values are treated as the floor.
func floorSeverity(sev, floor string) string {
	rank := map[string]int{"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
	s, okS := rank[sev]
	f := rank[floor]
	if !okS || s < f {
		return floor
	}
	return sev
}

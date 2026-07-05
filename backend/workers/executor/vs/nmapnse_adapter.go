package vs

import (
	"context"
	"fmt"
	"strings"

	"workers/executor/tools/nmap"
)

// NmapNSEAdapter implements Scanner as a network/service vulnerability engine.
// It drives the shared nmap tool wrapper (executor/tools/nmap) — the same
// binary/argv path ASM uses — and maps discovered open services/versions into
// normalized RawFindings.
//
// IMPORTANT — output shape: the shared wrapper runs a fixed argv
// (`nmap -sV -sC -p <ports> --script version <ip>`) and its ServiceResult only
// carries {IP, Port, Service, Version, Product}. It does NOT run `--script vuln`
// and does NOT parse any CVE/CVSS output. Per the VS design, this adapter
// therefore emits service/version findings (Category="service") and DEFERS
// CVE matching to the reporting consumer, which joins service→CVE at persist
// time. We deliberately do NOT fabricate CVEs or CVSS scores here.
//
// SafeMode: N/A meaningfully. Service/version detection (-sV) is standard,
// non-intrusive reconnaissance; the wrapper argv is fixed so there is no
// intrusive NSE category to gate on Profile.SafeMode.
type NmapNSEAdapter struct{}

// Name implements Scanner.
func (a *NmapNSEAdapter) Name() string { return "nmap_nse" }

// Enabled implements Scanner: runs when "nmap_nse" OR "nmap" is in the
// profile's engine list (case-insensitive).
func (a *NmapNSEAdapter) Enabled(p Profile) bool {
	for _, e := range p.Engines {
		switch strings.ToLower(strings.TrimSpace(e)) {
		case "nmap_nse", "nmap":
			return true
		}
	}
	return false
}

// Scan implements Scanner. It runs service/version detection against the
// target's host and known open ports, mapping each discovered service to a
// RawFinding. A missing nmap (and fallback service_detector) binary yields
// (nil, error) via the wrapper rather than a panic.
func (a *NmapNSEAdapter) Scan(ctx context.Context, t Target, p Profile) ([]RawFinding, error) {
	host := strings.TrimSpace(t.Host)
	if host == "" {
		return nil, nil
	}

	// Reuse the ASM nmap wrapper verbatim (parameterized argv, ctx-bound). Pass
	// the known open ports from the prior ASM/port-scan stage when available; the
	// wrapper falls back to its default port range when the slice is empty.
	results, err := nmap.RunServiceDetection(ctx, []string{host}, t.Ports)
	if err != nil {
		return nil, err
	}

	findings := make([]RawFinding, 0, len(results))
	for _, r := range results {
		service := strings.TrimSpace(r.Service)
		version := strings.TrimSpace(r.Version)
		if r.Product != "" {
			if version != "" {
				version = strings.TrimSpace(r.Product) + " " + version
			} else {
				version = strings.TrimSpace(r.Product)
			}
		}

		title := "Open service"
		if service != "" {
			title = "Open service: " + service
		}

		evidence := fmt.Sprintf("port=%d service=%s", r.Port, service)
		if version != "" {
			evidence += " version=" + version
		}

		desc := "nmap service/version detection reported an open service. " +
			"CVE matching is deferred to CVE enrichment at persist time (no CVEs are asserted by this engine)."

		findings = append(findings, RawFinding{
			AssetID:      t.AssetID,
			SourceEngine: a.Name(),
			// Stable per (service) slug; the reporting layer keys real plugin/
			// CVE identity during enrichment.
			PluginID:    "nmap-service-" + slugifyService(service),
			Title:       title,
			Description: desc,
			Category:    "service",
			// Service exposure alone carries no inherent severity; enrichment
			// assigns severity when it matches a CVE. Report as informational.
			Severity:   "info",
			Evidence:   evidence,
			Confidence: "firm",
			CVEs:       []string{}, // never fabricated; enriched downstream
			Location: map[string]any{
				"asset_id": t.AssetID,
				"host":     r.IP,
				"port":     r.Port,
				"service":  service,
				"version":  version,
			},
		})
	}

	return findings, nil
}

// slugifyService normalizes a service name into a stable PluginID fragment.
func slugifyService(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "unknown"
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return b.String()
}

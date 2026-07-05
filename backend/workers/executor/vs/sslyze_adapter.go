package vs

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"workers/executor/tools/sslscan"
)

// SslyzeAdapter implements Scanner as a TLS/SSL weakness engine. Despite the
// "sslyze" name (the canonical TLS-audit engine we expose to profiles), it
// drives the shared sslscan tool wrapper (executor/tools/sslscan) — the same
// binary/argv path ASM uses — and maps the reported certificate/protocol/cipher
// facts into normalized RawFindings.
//
// SafeMode: N/A. TLS scanning via sslscan is a passive handshake probe; it is
// never intrusive, so there is nothing to gate on Profile.SafeMode here.
type SslyzeAdapter struct{}

// Name implements Scanner.
func (a *SslyzeAdapter) Name() string { return "sslyze" }

// Enabled implements Scanner: runs when "sslyze" OR "sslscan" is in the
// profile's engine list (case-insensitive).
func (a *SslyzeAdapter) Enabled(p Profile) bool {
	for _, e := range p.Engines {
		switch strings.ToLower(strings.TrimSpace(e)) {
		case "sslyze", "sslscan":
			return true
		}
	}
	return false
}

// tlsPorts is the set of ports (beyond 443) that we treat as TLS-capable and
// therefore worth probing when present in the target's known open ports.
var tlsPorts = map[int]bool{
	443:  true, // https
	465:  true, // smtps
	563:  true, // nntps
	636:  true, // ldaps
	853:  true, // dns-over-tls
	989:  true, // ftps-data
	990:  true, // ftps
	992:  true, // telnets
	993:  true, // imaps
	995:  true, // pop3s
	5061: true, // sip-tls
	8443: true, // https-alt
}

// Scan implements Scanner. It probes the target's TLS endpoints via the sslscan
// wrapper and maps each reported weakness to a RawFinding. A missing sslscan
// (and fallback ssl_analyzer) binary yields (nil, error) rather than a panic:
// the wrapper itself swallows the missing-binary case (returning empty results),
// so we pre-check the binary here to surface it as a graceful error.
func (a *SslyzeAdapter) Scan(ctx context.Context, t Target, p Profile) ([]RawFinding, error) {
	host := strings.TrimSpace(t.Host)
	if host == "" {
		return nil, nil
	}

	// Graceful binary-absent handling. The wrapper's getToolPath is unexported
	// and, when the binary is missing, RunSSLAnalysis returns empty results with
	// no error — so it would look like "no weaknesses" rather than "could not
	// scan". Pre-check here to return an honest (nil, error) instead.
	if !binaryAvailable("sslscan") && !binaryAvailable("ssl_analyzer") {
		return nil, fmt.Errorf("sslyze adapter: neither sslscan nor ssl_analyzer binary found in PATH")
	}

	// Build the host:port probe list: always 443, plus any known TLS ports the
	// prior ASM/port-scan stage reported for this asset.
	seen := map[int]bool{}
	hosts := []string{fmt.Sprintf("%s:%d", host, 443)}
	seen[443] = true
	for _, port := range t.Ports {
		if port > 0 && tlsPorts[port] && !seen[port] {
			hosts = append(hosts, fmt.Sprintf("%s:%d", host, port))
			seen[port] = true
		}
	}

	// Reuse the ASM sslscan wrapper verbatim (parameterized argv, ctx-bound,
	// per-host timeout + bounded concurrency handled inside the wrapper).
	results, err := sslscan.RunSSLAnalysis(ctx, hosts)
	if err != nil {
		return nil, err
	}

	findings := make([]RawFinding, 0)
	for _, r := range results {
		findings = append(findings, mapTLSResult(t.AssetID, a.Name(), r)...)
	}
	return findings, nil
}

// binaryAvailable reports whether the named executable is resolvable on PATH.
// Mirrors the wrapper's primary lookup (exec.LookPath) without duplicating its
// unexported common-paths fallback; a false result reliably means "not on PATH".
func binaryAvailable(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// weakProtocols maps a protocol token (as it may appear in sslscan output) to a
// stable PluginID slug. SSLv2/SSLv3/TLS1.0/TLS1.1 are all deprecated/weak.
var weakProtocols = []struct {
	token string
	slug  string
	label string
}{
	{"sslv2", "tls-weak-protocol-sslv2", "SSLv2"},
	{"sslv3", "tls-weak-protocol-sslv3", "SSLv3"},
	{"tlsv1.0", "tls-weak-protocol-tls10", "TLSv1.0"},
	{"tls1.0", "tls-weak-protocol-tls10", "TLSv1.0"},
	{"tlsv1.1", "tls-weak-protocol-tls11", "TLSv1.1"},
	{"tls1.1", "tls-weak-protocol-tls11", "TLSv1.1"},
}

// weakCiphers maps a cipher family substring to a stable PluginID slug.
var weakCiphers = []struct {
	token string
	slug  string
	label string
}{
	{"rc4", "tls-weak-cipher-rc4", "RC4"},
	{"3des", "tls-weak-cipher-3des", "3DES"},
	{"des-cbc", "tls-weak-cipher-des", "DES"},
	{"null", "tls-weak-cipher-null", "NULL"},
	{"export", "tls-weak-cipher-export", "EXPORT"},
	{"md5", "tls-weak-cipher-md5", "MD5"},
}

// mapTLSResult turns a single sslscan SSLResult into zero or more RawFindings.
//
// It emits ONLY what the wrapper actually reports. The wrapper's parser
// populates Certificate/Issuer/ValidUntil/Cipher (Protocol is declared but not
// filled by the current parser), so protocol detection also inspects the Cipher
// string where sslscan embeds the negotiated protocol.
//
// UNVERIFIED — needs runtime: the exact date layout of ValidUntil and the
// precise line format sslscan emits vary by version; the parses below are
// best-effort and must be confirmed against a live sslscan binary.
func mapTLSResult(assetID, engine string, r sslscan.SSLResult) []RawFinding {
	out := make([]RawFinding, 0)

	loc := func() map[string]any {
		return map[string]any{
			"asset_id": assetID,
			"host":     r.Host,
			"port":     r.Port,
		}
	}

	// Expired certificate — parse ValidUntil; emit only if it parses AND is past.
	if r.ValidUntil != "" {
		if exp, ok := parseCertDate(r.ValidUntil); ok && exp.Before(time.Now()) {
			out = append(out, RawFinding{
				AssetID:      assetID,
				SourceEngine: engine,
				PluginID:     "tls-cert-expired",
				Title:        "Expired TLS certificate",
				Description:  "The server presented a TLS certificate whose validity period has ended.",
				Category:     "tls",
				Severity:     "high",
				Evidence:     "not_valid_after=" + strings.TrimSpace(r.ValidUntil),
				Confidence:   "firm",
				CVEs:         []string{},
				Location:     loc(),
			})
		}
	}

	// Self-signed certificate — subject equals issuer (both non-empty).
	subj := strings.TrimSpace(r.Certificate)
	iss := strings.TrimSpace(r.Issuer)
	if subj != "" && iss != "" && strings.EqualFold(subj, iss) {
		out = append(out, RawFinding{
			AssetID:      assetID,
			SourceEngine: engine,
			PluginID:     "tls-cert-self-signed",
			Title:        "Self-signed TLS certificate",
			Description:  "The server's TLS certificate subject matches its issuer, indicating a self-signed certificate not anchored to a trusted CA.",
			Category:     "tls",
			Severity:     "high",
			Evidence:     "subject=" + subj + "; issuer=" + iss,
			Confidence:   "firm",
			CVEs:         []string{},
			Location:     loc(),
		})
	}

	// Weak protocol — inspect Protocol and Cipher strings for deprecated tokens.
	protoHay := strings.ToLower(r.Protocol + " " + r.Cipher)
	for _, wp := range weakProtocols {
		if strings.Contains(protoHay, wp.token) {
			out = append(out, RawFinding{
				AssetID:      assetID,
				SourceEngine: engine,
				PluginID:     wp.slug,
				Title:        "Weak TLS protocol enabled: " + wp.label,
				Description:  "The server supports the deprecated/weak TLS protocol " + wp.label + ".",
				Category:     "tls",
				Severity:     "high",
				Evidence:     "protocol=" + wp.label,
				Confidence:   "firm",
				CVEs:         []string{},
				Location:     loc(),
			})
			break // one protocol finding per result is enough
		}
	}

	// Weak cipher — inspect the negotiated cipher string for weak families.
	cipherHay := strings.ToLower(r.Cipher)
	for _, wc := range weakCiphers {
		if strings.Contains(cipherHay, wc.token) {
			out = append(out, RawFinding{
				AssetID:      assetID,
				SourceEngine: engine,
				PluginID:     wc.slug,
				Title:        "Weak TLS cipher supported: " + wc.label,
				Description:  "The server negotiated a weak cipher (" + wc.label + ").",
				Category:     "tls",
				Severity:     "medium",
				Evidence:     "cipher=" + strings.TrimSpace(r.Cipher),
				Confidence:   "firm",
				CVEs:         []string{},
				Location:     loc(),
			})
			break // one cipher-weakness finding per result is enough
		}
	}

	return out
}

// certDateLayouts are candidate layouts for sslscan's "Not valid after" field.
// UNVERIFIED — confirm the actual layout against a live sslscan binary.
var certDateLayouts = []string{
	"Jan 2 15:04:05 2006 GMT",
	"2006-01-02 15:04:05",
	"2006-01-02T15:04:05Z07:00",
	time.RFC1123,
	time.RFC1123Z,
	"Mon Jan  2 15:04:05 2006",
}

func parseCertDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, layout := range certDateLayouts {
		if ts, err := time.Parse(layout, s); err == nil {
			return ts, true
		}
	}
	return time.Time{}, false
}

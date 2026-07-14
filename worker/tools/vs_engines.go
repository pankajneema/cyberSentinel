package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"worker/config"
	"worker/tools/nmap"
	"worker/tools/nuclei"
	"worker/tools/sslscan"
)

// VS (Vulnerability Scanning) engine adapters, ported from the old
// services/vs/*_adapter.go. Each engine self-registers under a vs_-prefixed name
// (so it never collides with the ASM "nuclei"/"nmap" tools) and reuses the exact
// wrapper bodies (nuclei.RunWithOptions, sslscan.RunSSLAnalysis,
// nmap.RunServiceDetection). VS operates per structured target (asset_id, host,
// url, ports) carried in job.config["vs_targets"]; profile knobs come from
// job.config. Findings are emitted with Type "vs_finding" and the report.vs
// field shape in Data, so the Python reporting layer maps them to vs_findings.

func init() {
	Register(vsNucleiTool{})
	Register(vsSslyzeTool{})
	Register(vsNmapNSETool{})
	Register(vsDefaultLoginTool{})
}

// ---- VS input parsing ----

type vsTarget struct {
	AssetID string
	Host    string
	URL     string
	Ports   []int
}

type vsProfile struct {
	SafeMode bool
	MaxRPS   int
}

// vsConfig pulls the config map from Input.Params (set by the engine).
func vsConfig(in Input) map[string]any {
	if c, ok := in.Params["config"].(map[string]any); ok {
		return c
	}
	return map[string]any{}
}

func vsTargets(in Input) []vsTarget {
	c := vsConfig(in)
	raw, ok := c["vs_targets"].([]any)
	if !ok {
		// Fallback: treat plain string targets as hosts under the job's asset_id.
		var out []vsTarget
		for _, h := range in.Targets {
			out = append(out, vsTarget{AssetID: in.AssetID, Host: h})
		}
		return out
	}
	var out []vsTarget
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		t := vsTarget{
			AssetID: str(m["asset_id"]),
			Host:    str(m["host"]),
			URL:     str(m["url"]),
		}
		if ports, ok := m["ports"].([]any); ok {
			for _, p := range ports {
				if iv := toInt(p); iv > 0 {
					t.Ports = append(t.Ports, iv)
				}
			}
		}
		if t.AssetID == "" {
			t.AssetID = in.AssetID
		}
		out = append(out, t)
	}
	return out
}

func vsProfileOf(in Input) vsProfile {
	c := vsConfig(in)
	return vsProfile{
		SafeMode: toBool(c["safe_mode"]),
		MaxRPS:   toInt(c["max_requests_per_sec"]),
	}
}

// resolveCredential fetches a decrypted authenticated-scan secret just-in-time
// from the core API internal endpoint (X-Internal-Token). Returns nil when the
// scan is not authenticated or no credential is configured. SECURITY: the secret
// lives only in the returned struct, is never logged, and is never serialized.
func resolveCredential(ctx context.Context, in Input) *Credential {
	c := vsConfig(in)
	if !toBool(c["authenticated"]) {
		return nil
	}
	credID := str(c["credential_id"])
	if credID == "" {
		return nil
	}
	orgID := str(in.Params["org_id"])
	cfg := config.Load()
	if cfg.ControlPlaneToken == "" || cfg.CoreAPIURL == "" {
		return nil
	}

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"credential_id": credID, "org_id": orgID})
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost,
		cfg.CoreAPIURL+"/api/v1/internal/vs/credential", bytes.NewReader(body))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", cfg.ControlPlaneToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var cr struct {
		CredType string `json:"cred_type"`
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil || cr.Secret == "" {
		return nil
	}
	return &Credential{Type: cr.CredType, Username: cr.Username, Secret: cr.Secret}
}

// Credential is a decrypted authenticated-scan secret held in memory only. It
// has no JSON tags and must never be placed on a serialized/logged struct.
type Credential struct {
	Type     string
	Username string
	Secret   string
}

// vsFinding builds a tools.Finding carrying the report.vs field shape in Data.
func vsFinding(engine string, t vsTarget, rf map[string]any) Finding {
	target := t.URL
	if target == "" {
		target = t.Host
	}
	return Finding{
		Type:     "vs_finding",
		Target:   target,
		Name:     str(rf["title"]),
		Severity: str(rf["severity"]),
		Data:     rf,
	}
}

// ---- vs_nuclei ----

type vsNucleiTool struct{}

func (vsNucleiTool) Name() string { return "vs_nuclei" }

func (vsNucleiTool) Run(ctx context.Context, in Input) (Output, error) {
	prof := vsProfileOf(in)
	cred := resolveCredential(ctx, in)
	headers := authHeaders(cred)
	var excludeTags []string
	if prof.SafeMode {
		excludeTags = vsSafeModeExcludeTags
	}
	out := Output{Raw: map[string]any{}}
	for _, t := range vsTargets(in) {
		target := firstNonEmpty(t.URL, t.Host)
		if target == "" {
			continue
		}
		results, err := nuclei.RunWithOptions(ctx, []string{target}, headers, excludeTags, nil, prof.MaxRPS)
		if err != nil {
			continue
		}
		for _, r := range results {
			if prof.SafeMode && hasIntrusiveTag(r.Tags) {
				continue
			}
			out.Findings = append(out.Findings, vsFinding("nuclei", t, rawFromNuclei("nuclei", t, r, "firm", "")))
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- vs_default_login ----

type vsDefaultLoginTool struct{}

func (vsDefaultLoginTool) Name() string { return "vs_default_login" }

func (vsDefaultLoginTool) Run(ctx context.Context, in Input) (Output, error) {
	prof := vsProfileOf(in)
	cred := resolveCredential(ctx, in)
	headers := authHeaders(cred)
	var excludeTags []string
	if prof.SafeMode {
		excludeTags = vsSafeModeExcludeTags
	}
	out := Output{Raw: map[string]any{}}
	for _, t := range vsTargets(in) {
		target := firstNonEmpty(t.URL, t.Host)
		if target == "" {
			continue
		}
		results, err := nuclei.RunWithOptions(ctx, []string{target}, headers, excludeTags, []string{"default-login"}, prof.MaxRPS)
		if err != nil {
			continue
		}
		for _, r := range results {
			if prof.SafeMode && hasIntrusiveTag(r.Tags) {
				continue
			}
			out.Findings = append(out.Findings, vsFinding("default-login", t,
				rawFromNuclei("default-login", t, r, "confirmed", "weak_credential")))
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- vs_nmap_nse ----

type vsNmapNSETool struct{}

func (vsNmapNSETool) Name() string { return "vs_nmap_nse" }

func (vsNmapNSETool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	for _, t := range vsTargets(in) {
		if t.Host == "" {
			continue
		}
		results, err := nmap.RunServiceDetection(ctx, []string{t.Host}, t.Ports)
		if err != nil {
			continue
		}
		for _, r := range results {
			service := strings.TrimSpace(r.Service)
			version := strings.TrimSpace(r.Version)
			if r.Product != "" {
				version = strings.TrimSpace(strings.TrimSpace(r.Product) + " " + version)
			}
			title := "Open service"
			if service != "" {
				title = "Open service: " + service
			}
			rf := map[string]any{
				"asset_id": t.AssetID, "source_engine": "nmap_nse",
				"plugin_id": "nmap-service-" + slugifyService(service),
				"title":     title,
				"description": "nmap service/version detection reported an open service; " +
					"CVE matching is deferred to enrichment at persist time.",
				"category": "service", "severity": "info",
				"evidence":   fmt.Sprintf("port=%d service=%s version=%s", r.Port, service, version),
				"confidence": "firm", "cve_ids": []string{}, "cvss_base": 0.0,
				"location": map[string]any{"asset_id": t.AssetID, "host": r.IP, "port": r.Port, "service": service, "version": version},
			}
			out.Findings = append(out.Findings, vsFinding("nmap_nse", t, rf))
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- vs_sslyze (drives the sslscan wrapper) ----

type vsSslyzeTool struct{}

func (vsSslyzeTool) Name() string { return "vs_sslyze" }

func (vsSslyzeTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	if !binaryAvailable("sslscan") && !binaryAvailable("ssl_analyzer") {
		return Output{}, fmt.Errorf("vs_sslyze: neither sslscan nor ssl_analyzer binary found")
	}
	for _, t := range vsTargets(in) {
		if t.Host == "" {
			continue
		}
		seen := map[int]bool{443: true}
		hosts := []string{fmt.Sprintf("%s:%d", t.Host, 443)}
		for _, p := range t.Ports {
			if p > 0 && tlsPorts[p] && !seen[p] {
				hosts = append(hosts, fmt.Sprintf("%s:%d", t.Host, p))
				seen[p] = true
			}
		}
		results, err := sslscan.RunSSLAnalysis(ctx, hosts)
		if err != nil {
			continue
		}
		for _, r := range results {
			for _, rf := range mapTLSResult(t.AssetID, "sslyze", r) {
				out.Findings = append(out.Findings, vsFinding("sslyze", t, rf))
			}
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- shared VS mapping helpers (ported from services/vs) ----

var vsSafeModeExcludeTags = []string{"dos", "intrusive", "fuzzing"}
var vsIntrusiveTags = map[string]bool{"dos": true, "intrusive": true, "fuzz": true, "fuzzing": true}

func hasIntrusiveTag(tags []string) bool {
	for _, tag := range tags {
		if vsIntrusiveTags[strings.ToLower(strings.TrimSpace(tag))] {
			return true
		}
	}
	return false
}

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
		return []string{"Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(c.Username+":"+c.Secret))}
	default:
		return nil
	}
}

// rawFromNuclei builds the report.vs finding map from a nuclei result. floorSev
// (non-empty) raises the severity floor (used by default-login).
func rawFromNuclei(engine string, t vsTarget, r nuclei.Finding, confidence, forceCategory string) map[string]any {
	location := map[string]any{"asset_id": t.AssetID}
	if r.MatchedAt != "" {
		location["url"] = r.MatchedAt
	}
	if r.Host != "" {
		location["host"] = r.Host
	}
	if r.Port != "" {
		location["port"] = r.Port
	}
	category := forceCategory
	if category == "" {
		category = deriveCategory(r.CVEs, r.Tags)
	}
	severity := normalizeSeverity(r.Severity)
	if engine == "default-login" {
		severity = floorSeverity(severity, "high")
	}
	return map[string]any{
		"asset_id": t.AssetID, "source_engine": engine, "plugin_id": r.TemplateID,
		"title": r.Name, "description": r.Description, "category": category,
		"severity": severity, "evidence": buildEvidence(r.MatcherName, r.ExtractedResults),
		"confidence": confidence, "cve_ids": normalizeCVEs(r.CVEs), "cvss_base": r.CVSSBase,
		"location": location,
	}
}

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
	if s == "" {
		return "info"
	}
	return s
}

func normalizeCVEs(cves []string) []string {
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

func floorSeverity(sev, floor string) string {
	rank := map[string]int{"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
	s, ok := rank[sev]
	if !ok || s < rank[floor] {
		return floor
	}
	return sev
}

func binaryAvailable(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

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

var tlsPorts = map[int]bool{443: true, 465: true, 563: true, 636: true, 853: true, 989: true, 990: true, 992: true, 993: true, 995: true, 5061: true, 8443: true}

var vsWeakProtocols = []struct{ token, slug, label string }{
	{"sslv2", "tls-weak-protocol-sslv2", "SSLv2"}, {"sslv3", "tls-weak-protocol-sslv3", "SSLv3"},
	{"tlsv1.0", "tls-weak-protocol-tls10", "TLSv1.0"}, {"tls1.0", "tls-weak-protocol-tls10", "TLSv1.0"},
	{"tlsv1.1", "tls-weak-protocol-tls11", "TLSv1.1"}, {"tls1.1", "tls-weak-protocol-tls11", "TLSv1.1"},
}
var vsWeakCiphers = []struct{ token, slug, label string }{
	{"rc4", "tls-weak-cipher-rc4", "RC4"}, {"3des", "tls-weak-cipher-3des", "3DES"},
	{"des-cbc", "tls-weak-cipher-des", "DES"}, {"null", "tls-weak-cipher-null", "NULL"},
	{"export", "tls-weak-cipher-export", "EXPORT"}, {"md5", "tls-weak-cipher-md5", "MD5"},
}
var certDateLayouts = []string{"Jan 2 15:04:05 2006 GMT", "2006-01-02 15:04:05", "2006-01-02T15:04:05Z07:00", time.RFC1123, time.RFC1123Z, "Mon Jan  2 15:04:05 2006"}

func parseCertDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, layout := range certDateLayouts {
		if ts, err := time.Parse(layout, s); err == nil {
			return ts, true
		}
	}
	return time.Time{}, false
}

func mapTLSResult(assetID, engine string, r sslscan.SSLResult) []map[string]any {
	out := make([]map[string]any, 0)
	loc := func() map[string]any { return map[string]any{"asset_id": assetID, "host": r.Host, "port": r.Port} }
	base := func(pluginID, title, desc, severity, evidence string) map[string]any {
		return map[string]any{
			"asset_id": assetID, "source_engine": engine, "plugin_id": pluginID, "title": title,
			"description": desc, "category": "tls", "severity": severity, "evidence": evidence,
			"confidence": "firm", "cve_ids": []string{}, "cvss_base": 0.0, "location": loc(),
		}
	}
	if r.ValidUntil != "" {
		if exp, ok := parseCertDate(r.ValidUntil); ok && exp.Before(time.Now()) {
			out = append(out, base("tls-cert-expired", "Expired TLS certificate",
				"The server presented a TLS certificate whose validity period has ended.", "high",
				"not_valid_after="+strings.TrimSpace(r.ValidUntil)))
		}
	}
	subj, iss := strings.TrimSpace(r.Certificate), strings.TrimSpace(r.Issuer)
	if subj != "" && iss != "" && strings.EqualFold(subj, iss) {
		out = append(out, base("tls-cert-self-signed", "Self-signed TLS certificate",
			"The server's TLS certificate subject matches its issuer.", "high", "subject="+subj+"; issuer="+iss))
	}
	protoHay := strings.ToLower(r.Protocol + " " + r.Cipher)
	for _, wp := range vsWeakProtocols {
		if strings.Contains(protoHay, wp.token) {
			out = append(out, base(wp.slug, "Weak TLS protocol enabled: "+wp.label,
				"The server supports the deprecated/weak TLS protocol "+wp.label+".", "high", "protocol="+wp.label))
			break
		}
	}
	cipherHay := strings.ToLower(r.Cipher)
	for _, wc := range vsWeakCiphers {
		if strings.Contains(cipherHay, wc.token) {
			out = append(out, base(wc.slug, "Weak TLS cipher supported: "+wc.label,
				"The server negotiated a weak cipher ("+wc.label+").", "medium", "cipher="+strings.TrimSpace(r.Cipher)))
			break
		}
	}
	return out
}

// ---- tiny coercions for JSON-decoded config values ----

func toBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

package tools

import (
	"context"
	"fmt"
	"net/netip"
	"strings"

	"worker/tools/httpx"
	"worker/tools/nmap"
	"worker/tools/sslscan"
)

// ASM ip-pipeline "service" adapters, ported from the old
// services/asm/{executor.go, ip.go, service.go}. These stages operate over the
// IP targets discovered by earlier stages (prior TypeIP findings) plus the open
// ports found by the port-scan stages (prior "port" findings, Data["port"]).
//
// The old executor cases were:
//   - ip_service_fingerprint_{light,normal,deep} + ip_banner_grab ->
//     runServiceFingerprint (nmap -sV over discovered ports) -> "services".
//   - ip_http_probe_{light,normal,deep} -> runHTTPProbeForIPs (httpx) -> "responses".
//   - ip_tls_deep -> TLS metadata over 443 + discovered TLS ports.
//
// Intensity was only logged (all three variants ran identical detection), so the
// three fingerprint / three http-probe names share one runner each here.
//
// SECURITY (CWE-918): every IP is re-checked through the SSRF guard
// (forbiddenScanIPSvc, ported verbatim from ip.go's isForbiddenScanIP) before it
// is handed to any scanner, and any CIDR target is expanded through
// expandCIDRSvc so internal/reserved/metadata addresses can never be scanned even
// if they reached us via DNS rebinding or a manual CIDR entry.
func init() {
	Register(ipSvcFingerprintTool{"ip_service_fingerprint_light"})
	Register(ipSvcFingerprintTool{"ip_service_fingerprint_normal"})
	Register(ipSvcFingerprintTool{"ip_service_fingerprint_deep"})
	Register(ipSvcFingerprintTool{"ip_banner_grab"})
	Register(ipSvcHTTPTool{"ip_http_probe_light"})
	Register(ipSvcHTTPTool{"ip_http_probe_normal"})
	Register(ipSvcHTTPTool{"ip_http_probe_deep"})
	Register(ipSvcTLSTool{})
}

// ---- SSRF guard + CIDR expansion (ported from ip.go) ----

// forbiddenScanIPSvc reports whether an address must never be scanned: loopback,
// RFC1918/ULA private, link-local (incl. 169.254.169.254 cloud metadata),
// multicast, or the unspecified address. Authoritative SSRF guard applied AFTER
// resolution/CIDR expansion, so it also defeats DNS rebinding.
func forbiddenScanIPSvc(s string) bool {
	ip, err := netip.ParseAddr(s)
	if err != nil {
		return true // unparseable -> drop
	}
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified()
}

// expandCIDRSvc enumerates the addresses of a CIDR block up to limit, masked to
// the network. Empty on parse failure.
func expandCIDRSvc(cidr string, limit int) []string {
	prefix, err := netip.ParsePrefix(cidr)
	if err != nil {
		return nil
	}
	prefix = prefix.Masked()
	addr := prefix.Addr()
	if !addr.IsValid() {
		return nil
	}
	out := make([]string, 0)
	for current := addr; prefix.Contains(current); current = current.Next() {
		out = append(out, current.String())
		if len(out) >= limit {
			break
		}
	}
	return out
}

// svcScanIPs collects the IPs to scan: prior TypeIP findings first (already the
// alive/seed set), falling back to the job's raw targets. Every candidate is
// run through the SSRF guard; CIDR targets are expanded (bounded) and each member
// guarded, so no internal/reserved address is ever scanned.
func svcScanIPs(in Input) []string {
	candidates := Subjects(in, TypeIP)
	if len(candidates) == 0 {
		candidates = roots(in)
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(candidates))
	add := func(ip string) {
		ip = strings.TrimSpace(ip)
		if ip == "" || seen[ip] || forbiddenScanIPSvc(ip) {
			return
		}
		seen[ip] = true
		out = append(out, ip)
	}
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if strings.Contains(c, "/") {
			for _, ip := range expandCIDRSvc(c, 4096) {
				add(ip)
			}
			continue
		}
		add(c)
	}
	return out
}

// ---- ip_service_fingerprint_* / ip_banner_grab: nmap -sV over open ports ----

type ipSvcFingerprintTool struct{ name string }

func (t ipSvcFingerprintTool) Name() string { return t.name }

func (t ipSvcFingerprintTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := svcScanIPs(in)
	ports := priorPorts(in) // prior "port" findings' Data["port"], deduped
	out := Output{Raw: map[string]any{}}
	if len(ips) == 0 {
		out.Raw["note"] = "no IP targets to fingerprint"
		return out, nil
	}
	// Best-effort per IP so one nmap failure never fails the stage. Mirrors the
	// old runServiceFingerprint, which grouped ports by IP and continued on error.
	for _, ip := range ips {
		svc, err := nmap.RunServiceDetection(ctx, []string{ip}, ports)
		if err != nil {
			continue
		}
		for _, s := range svc {
			out.Findings = append(out.Findings, Finding{
				Type:   "service",
				Target: s.IP,
				Name:   s.Service,
				Data: map[string]any{
					"ip":       s.IP,
					"port":     s.Port,
					"service":  s.Service,
					"version":  s.Version,
					"product":  s.Product,
					"protocol": "tcp",
				},
			})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- ip_http_probe_*: httpx status/title/server over discovered IPs ----

type ipSvcHTTPTool struct{ name string }

func (t ipSvcHTTPTool) Name() string { return t.name }

func (t ipSvcHTTPTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := svcScanIPs(in)
	out := Output{Raw: map[string]any{}}
	if len(ips) == 0 {
		out.Raw["note"] = "no IP targets to probe"
		return out, nil
	}
	responses, err := httpx.RunHTTPStatus(ctx, ips)
	if err != nil {
		// Best-effort: report empty rather than fail the stage.
		out.Raw["note"] = fmt.Sprintf("httpx unavailable: %v", err)
		return out, nil
	}
	for _, r := range responses {
		out.Findings = append(out.Findings, Finding{
			Type:   TypeHTTP,
			Target: r.URL,
			Name:   r.Title,
			Data: map[string]any{
				"ip":          r.URL,
				"status_code": r.StatusCode,
				"https":       r.HTTPS,
				"server":      r.Server,
				"title":       r.Title,
			},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- ip_tls_deep: sslscan over ip:443 + discovered TLS ports -> "tls" ----

type ipSvcTLSTool struct{}

func (ipSvcTLSTool) Name() string { return "ip_tls_deep" }

func (ipSvcTLSTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := svcScanIPs(in)
	out := Output{Raw: map[string]any{}}
	if len(ips) == 0 {
		out.Raw["note"] = "no IP targets for TLS analysis"
		return out, nil
	}
	// TLS ports: always 443, plus any discovered port that commonly serves TLS
	// (tlsPorts map is defined in vs_engines.go, same package).
	ports := []int{443}
	seenPort := map[int]bool{443: true}
	for _, p := range priorPorts(in) {
		if tlsPorts[p] && !seenPort[p] {
			seenPort[p] = true
			ports = append(ports, p)
		}
	}
	// Build host:port scan list.
	var hosts []string
	for _, ip := range ips {
		for _, p := range ports {
			hosts = append(hosts, fmt.Sprintf("%s:%d", ip, p))
		}
	}
	results, err := sslscan.RunSSLAnalysis(ctx, hosts)
	if err != nil {
		out.Raw["note"] = fmt.Sprintf("sslscan unavailable: %v", err)
		return out, nil
	}
	for _, r := range results {
		out.Findings = append(out.Findings, Finding{
			Type:   "tls",
			Target: r.Host,
			Name:   r.Issuer,
			Data: map[string]any{
				"host":        r.Host,
				"port":        r.Port,
				"protocol":    r.Protocol,
				"cipher":      r.Cipher,
				"certificate": r.Certificate,
				"issuer":      r.Issuer,
				"valid_until": r.ValidUntil,
			},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

package asm

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"workers/config"
	"workers/tools/httpx"
	"workers/utils"
)

// buildServiceSeedTargets resolves the target(s) for a `service` asset-type scan.
// It mirrors how buildIPSeedTargets seeds IP scans (asset name + discovery
// manual_targets) but preserves hostnames/host:port forms because a service
// target is frequently a DNS name rather than a bare IP. Literal IP targets are
// still passed through the SSRF guard (isForbiddenScanIP) so internal/reserved
// addresses can never be scanned (CWE-918).
func buildServiceSeedTargets(ctx context.Context, jobID, assetID string) ([]string, error) {
	seen := map[string]bool{}
	targets := make([]string, 0)

	appendTarget := func(raw string) {
		for _, part := range strings.FieldsFunc(strings.TrimSpace(raw), func(r rune) bool {
			return r == ',' || r == '\n' || r == '\t' || r == ' '
		}) {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			// Strip scheme if present (httpx/nuclei accept bare host[:port]).
			part = strings.TrimPrefix(strings.TrimPrefix(part, "https://"), "http://")
			part = strings.TrimSuffix(part, "/")
			if part == "" || seen[part] {
				continue
			}
			// If the host portion is a literal IP, enforce the SSRF guard.
			host := part
			if h, _, err := net.SplitHostPort(part); err == nil {
				host = h
			}
			if ip := net.ParseIP(host); ip != nil && isForbiddenScanIP(host) {
				continue
			}
			seen[part] = true
			targets = append(targets, part)
		}
	}

	if assetID != "" {
		assetName, err := AssetName(ctx, assetID)
		if err == nil && strings.TrimSpace(assetName) != "" {
			appendTarget(assetName)
		}
	}

	targetSource, manualTargetsRaw, err := DiscoveryTargets(ctx, jobID)
	if err == nil && strings.EqualFold(targetSource, "MANUAL_ENTRY") && len(manualTargetsRaw) > 0 {
		var manualTargets []string
		if parseErr := json.Unmarshal(manualTargetsRaw, &manualTargets); parseErr == nil {
			for _, target := range manualTargets {
				appendTarget(target)
			}
		}
	}

	if len(targets) == 0 {
		return nil, errors.New("no service targets resolved from asset/manual input")
	}
	return targets, nil
}

// hostOnly strips an optional :port suffix, returning the bare host for tools
// (naabu/nmap top-ports) that expect a host without a port.
func hostOnly(target string) string {
	if h, _, err := net.SplitHostPort(target); err == nil {
		return h
	}
	return target
}

// runHTTPBannerCheck fetches HTTP status/title/server banners for the given
// service targets. It prefers the httpx wrapper (consistent with sibling steps)
// and falls back to a dependency-free native HTTP probe if the httpx binary is
// unavailable or errors, so a service scan never dies at step 1.
func runHTTPBannerCheck(ctx context.Context, targets []string) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(targets))

	responses, err := httpx.RunHTTPStatus(ctx, targets)
	if err == nil && len(responses) > 0 {
		for _, r := range responses {
			out = append(out, map[string]interface{}{
				"target":      r.URL,
				"status_code": r.StatusCode,
				"https":       r.HTTPS,
				"title":       r.Title,
				"server":      r.Server,
			})
		}
		return out
	}
	if err != nil {
		utils.Logger.Warnf("service http_banner_check: httpx unavailable (%v), using native probe", err)
	}

	// Native fallback: try https then http per target.
	client := &http.Client{
		Timeout: 6 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig:   &tls.Config{InsecureSkipVerify: true}, // #nosec G402 - banner grab only
			DisableKeepAlives: true,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	for _, target := range targets {
		var got map[string]interface{}
		for _, scheme := range []string{"https", "http"} {
			reqCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
			req, reqErr := http.NewRequestWithContext(reqCtx, http.MethodGet, scheme+"://"+target, nil)
			if reqErr != nil {
				cancel()
				continue
			}
			resp, doErr := client.Do(req)
			if doErr != nil || resp == nil {
				cancel()
				continue
			}
			server := resp.Header.Get("Server")
			_ = resp.Body.Close()
			cancel()
			got = map[string]interface{}{
				"target":      target,
				"status_code": resp.StatusCode,
				"https":       scheme == "https",
				"title":       "",
				"server":      server,
			}
			break
		}
		if got == nil {
			got = map[string]interface{}{
				"target":      target,
				"status_code": 0,
				"https":       false,
				"title":       "",
				"server":      "",
			}
		}
		out = append(out, got)
	}
	return out
}

// runTLSHandshake performs a real crypto/tls handshake against each host on the
// given TLS ports and extracts the negotiated cipher/version plus the leaf
// certificate subject/issuer/not-after. InsecureSkipVerify is intentional: this
// is reconnaissance, we must not reject self-signed/expired certs, we report them.
func runTLSHandshake(ctx context.Context, hosts []string, ports []int) []map[string]interface{} {
	results := make([]map[string]interface{}, 0)
	if len(ports) == 0 {
		ports = []int{443}
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	for _, host := range hosts {
		for _, port := range ports {
			entry := map[string]interface{}{
				"host":         host,
				"port":         port,
				"protocol":     "tls",
				"tls_version":  "",
				"cipher":       "",
				"certificate":  "",
				"issuer":       "",
				"valid_until":  "",
				"handshake_ok": false,
			}

			hsCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
			rawConn, dialErr := dialer.DialContext(hsCtx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
			if dialErr != nil {
				cancel()
				entry["error"] = dialErr.Error()
				results = append(results, entry)
				continue
			}

			tlsConn := tls.Client(rawConn, &tls.Config{
				InsecureSkipVerify: true, // #nosec G402 - recon: report certs, don't reject
				ServerName:         host,
			})
			_ = tlsConn.SetDeadline(time.Now().Add(6 * time.Second))
			hsErr := tlsConn.HandshakeContext(hsCtx)
			if hsErr != nil {
				_ = tlsConn.Close()
				cancel()
				entry["error"] = hsErr.Error()
				results = append(results, entry)
				continue
			}

			state := tlsConn.ConnectionState()
			entry["handshake_ok"] = true
			entry["tls_version"] = tlsVersionName(state.Version)
			entry["cipher"] = tls.CipherSuiteName(state.CipherSuite)
			if len(state.PeerCertificates) > 0 {
				leaf := state.PeerCertificates[0]
				entry["certificate"] = leaf.Subject.String()
				entry["issuer"] = leaf.Issuer.String()
				entry["valid_until"] = leaf.NotAfter.UTC().Format(time.RFC3339)
				entry["valid_from"] = leaf.NotBefore.UTC().Format(time.RFC3339)
			}
			_ = tlsConn.Close()
			cancel()
			results = append(results, entry)
		}
	}
	return results
}

func tlsVersionName(v uint16) string {
	switch v {
	case tls.VersionTLS10:
		return "TLS 1.0"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS13:
		return "TLS 1.3"
	default:
		return fmt.Sprintf("0x%04x", v)
	}
}

// enrichmentByIP indexes the ip_enrichment step output (ip -> asn) so the
// relationship map can group by real ASN rather than fabricated edges.
func enrichmentByIP(pipeline []ToolResult, upto int, assetID string) map[string]string {
	asnByIP := map[string]string{}
	for idx := 0; idx < upto; idx++ {
		step := pipeline[idx]
		if step.Status != "COMPLETED" {
			continue
		}
		if assetID != "" && step.AssetID != "" && step.AssetID != assetID {
			continue
		}
		if step.Step != "asn_geo_mapping" {
			continue
		}
		raw, ok := step.Result["enrichment"]
		if !ok {
			continue
		}
		items, ok := raw.([]interface{})
		if !ok {
			// May already be concrete typed slice within same process run.
			if typed, ok2 := raw.([]map[string]interface{}); ok2 {
				for _, m := range typed {
					ip, _ := m["ip"].(string)
					asn, _ := m["asn"].(string)
					if ip != "" && asn != "" {
						asnByIP[ip] = asn
					}
				}
			}
			continue
		}
		for _, item := range items {
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			ip, _ := m["ip"].(string)
			asn, _ := m["asn"].(string)
			if ip != "" && asn != "" {
				asnByIP[ip] = asn
			}
		}
	}
	return asnByIP
}

// computeIPRelationships builds real adjacency between discovered IPs by
// grouping them into shared /24 subnets and shared ASNs. Only groups with more
// than one member produce an edge set (no fabricated single-node "relationships").
func computeIPRelationships(ips []string, asnByIP map[string]string) map[string]interface{} {
	subnetGroups := map[string][]string{}
	asnGroups := map[string][]string{}

	for _, ip := range ips {
		if subnet := slash24(ip); subnet != "" {
			subnetGroups[subnet] = append(subnetGroups[subnet], ip)
		}
		if asn := strings.TrimSpace(asnByIP[ip]); asn != "" {
			asnGroups[asn] = append(asnGroups[asn], ip)
		}
	}

	subnetClusters := make([]map[string]interface{}, 0)
	for subnet, members := range subnetGroups {
		if len(members) < 2 {
			continue
		}
		sort.Strings(members)
		subnetClusters = append(subnetClusters, map[string]interface{}{
			"subnet":  subnet,
			"members": members,
			"count":   len(members),
		})
	}
	sort.Slice(subnetClusters, func(a, b int) bool {
		return subnetClusters[a]["subnet"].(string) < subnetClusters[b]["subnet"].(string)
	})

	asnClusters := make([]map[string]interface{}, 0)
	for asn, members := range asnGroups {
		if len(members) < 2 {
			continue
		}
		sort.Strings(members)
		asnClusters = append(asnClusters, map[string]interface{}{
			"asn":     asn,
			"members": members,
			"count":   len(members),
		})
	}
	sort.Slice(asnClusters, func(a, b int) bool {
		return asnClusters[a]["asn"].(string) < asnClusters[b]["asn"].(string)
	})

	return map[string]interface{}{
		"total_ips":       len(ips),
		"subnet_clusters": subnetClusters,
		"asn_clusters":    asnClusters,
	}
}

// slash24 returns the /24 network (IPv4) or /64 network (IPv6) string for an IP,
// or "" if unparseable.
func slash24(ipStr string) string {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return ""
	}
	if v4 := ip.To4(); v4 != nil {
		return fmt.Sprintf("%d.%d.%d.0/24", v4[0], v4[1], v4[2])
	}
	// IPv6: group by /64.
	mask := net.CIDRMask(64, 128)
	return (&net.IPNet{IP: ip.Mask(mask), Mask: mask}).String()
}

// --- ip_diff baseline compare ------------------------------------------------

// ipBaseline is the persisted snapshot used to diff consecutive runs of the same
// discovery. Stored in Redis under asm:ip_baseline:<jobID>:<assetID> because ASM
// pipeline state for the workers lives in Redis (asm:pipeline:<jobID>); there is
// no per-IP results table in the workers DB.
type ipBaseline struct {
	IPs        []string       `json:"ips"`
	Ports      map[string]int `json:"ports"` // "ip:port" -> 1 (set semantics, JSON-friendly)
	CapturedAt string         `json:"captured_at"`
}

func ipBaselineKey(jobID, assetID string) string {
	if assetID == "" {
		return fmt.Sprintf("asm:ip_baseline:%s", jobID)
	}
	return fmt.Sprintf("asm:ip_baseline:%s:%s", jobID, assetID)
}

// portKeySet flattens port results ([{ip,port}]) into a "ip:port" set.
func portKeySet(ports []map[string]interface{}) map[string]int {
	set := map[string]int{}
	for _, p := range ports {
		ip, _ := p["ip"].(string)
		if ip == "" {
			continue
		}
		var port int
		switch v := p["port"].(type) {
		case int:
			port = v
		case float64:
			port = int(v)
		}
		if port <= 0 {
			continue
		}
		set[fmt.Sprintf("%s:%d", ip, port)] = 1
	}
	return set
}

// runIPDiff loads the previous baseline snapshot for this discovery/asset and
// computes added/removed IPs and ports versus the current run, then persists the
// current run as the new baseline. When no baseline exists it returns an honest
// "no baseline" result (no fabricated success).
func runIPDiff(ctx context.Context, jobID, assetID string, currentIPs []string, currentPorts []map[string]interface{}) map[string]interface{} {
	key := ipBaselineKey(jobID, assetID)
	curPortSet := portKeySet(currentPorts)

	current := ipBaseline{
		IPs:        dedupeIPs(currentIPs),
		Ports:      curPortSet,
		CapturedAt: time.Now().UTC().Format(time.RFC3339),
	}

	// Persist the current snapshot as the new baseline for the next run.
	// Failure to persist is non-fatal for the diff result itself.
	defer func() {
		if data, err := json.Marshal(current); err == nil {
			saveCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			if setErr := config.Set(saveCtx, key, string(data), 90*24*time.Hour); setErr != nil {
				utils.Logger.Warnf("ip_diff: failed to persist baseline key=%s: %v", key, setErr)
			}
		}
	}()

	loadCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	raw, err := config.Get(loadCtx, key)
	if err != nil || strings.TrimSpace(raw) == "" {
		return map[string]interface{}{
			"has_baseline":  false,
			"message":       "No previous baseline for this discovery; current run recorded as baseline.",
			"current_ips":   len(current.IPs),
			"current_ports": len(curPortSet),
		}
	}

	var prev ipBaseline
	if unErr := json.Unmarshal([]byte(raw), &prev); unErr != nil {
		utils.Logger.Warnf("ip_diff: corrupt baseline key=%s: %v", key, unErr)
		return map[string]interface{}{
			"has_baseline":  false,
			"message":       "Previous baseline unreadable; current run recorded as new baseline.",
			"current_ips":   len(current.IPs),
			"current_ports": len(curPortSet),
		}
	}

	prevIPSet := map[string]bool{}
	for _, ip := range prev.IPs {
		prevIPSet[ip] = true
	}
	curIPSet := map[string]bool{}
	for _, ip := range current.IPs {
		curIPSet[ip] = true
	}

	addedIPs := diffSetSlice(curIPSet, prevIPSet)
	removedIPs := diffSetSlice(prevIPSet, curIPSet)
	addedPorts := diffKeySlice(curPortSet, prev.Ports)
	removedPorts := diffKeySlice(prev.Ports, curPortSet)

	return map[string]interface{}{
		"has_baseline":  true,
		"baseline_at":   prev.CapturedAt,
		"added_ips":     addedIPs,
		"removed_ips":   removedIPs,
		"added_ports":   addedPorts,
		"removed_ports": removedPorts,
		"changed":       len(addedIPs)+len(removedIPs)+len(addedPorts)+len(removedPorts) > 0,
	}
}

// collectPortResults gathers open-port records ([{ip,port,protocol}]) from all
// completed common_port_scan steps up to `upto`, scoped to the asset.
func collectPortResults(pipeline []ToolResult, upto int, assetID string) []map[string]interface{} {
	out := make([]map[string]interface{}, 0)
	for idx := 0; idx < upto; idx++ {
		step := pipeline[idx]
		if step.Status != "COMPLETED" {
			continue
		}
		if assetID != "" && step.AssetID != "" && step.AssetID != assetID {
			continue
		}
		if step.Step != "common_port_scan" {
			continue
		}
		raw, ok := step.Result["ports"]
		if !ok {
			continue
		}
		switch items := raw.(type) {
		case []interface{}:
			for _, item := range items {
				if m, ok := item.(map[string]interface{}); ok {
					out = append(out, m)
				}
			}
		case []map[string]interface{}:
			out = append(out, items...)
		}
	}
	return out
}

// collectTLSPorts returns the set of ports worth a TLS handshake: any discovered
// port commonly serving TLS, always including 443.
func collectTLSPorts(pipeline []ToolResult, upto int, assetID string) []int {
	tlsCommon := map[int]bool{443: true, 8443: true, 465: true, 993: true, 995: true, 990: true, 636: true, 989: true, 992: true, 5061: true}
	found := map[int]bool{443: true}
	for _, p := range collectPortResults(pipeline, upto, assetID) {
		var port int
		switch v := p["port"].(type) {
		case int:
			port = v
		case float64:
			port = int(v)
		}
		if tlsCommon[port] {
			found[port] = true
		}
	}
	ports := make([]int, 0, len(found))
	for port := range found {
		ports = append(ports, port)
	}
	sort.Ints(ports)
	return ports
}

func diffSetSlice(a, b map[string]bool) []string {
	out := make([]string, 0)
	for k := range a {
		if !b[k] {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func diffKeySlice(a, b map[string]int) []string {
	out := make([]string, 0)
	for k := range a {
		if _, ok := b[k]; !ok {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"sort"
	"strings"
	"time"
)

// ASM IP-enrichment pipeline adapters, ported from the old
// backend/workers/services/asm/{ip.go,service.go,executor.go}. These stages run
// against IPs discovered by earlier IP-asset stages; the engine threads those in
// as prior findings of Type "ip". Geo/ASN enrichment (ip-api.com) and RDAP
// (rdap.org) are direct HTTP calls exactly as the old code did. Every IP is
// passed through the authoritative SSRF guard (isForbiddenScanIPEnrich) before
// any network call, defeating DNS-rebinding / internal-address enrichment.

func init() {
	Register(ipEnrichTool{"ip_enrichment_cached"})
	Register(ipEnrichTool{"ip_enrichment_fresh"})
	Register(ipRdapTool{"ip_whois_rdap"})
	Register(ipRdapTool{"ip_whois_rdap_fresh"})
	Register(ipRelationshipTool{})
	Register(ipExposureScoreTool{})
	Register(ipFindingsSummaryTool{})
}

// ---- SSRF guard + CIDR/subnet helpers (ported verbatim from ip.go/service.go) ----

// isForbiddenScanIPEnrich reports whether an address must never be scanned or
// enriched: loopback, RFC1918/ULA private, link-local (incl. 169.254.169.254
// cloud metadata), multicast, or the unspecified address. Authoritative SSRF
// guard (CWE-918) applied after any resolution/expansion.
func isForbiddenScanIPEnrich(s string) bool {
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

// expandCIDREnrich expands a CIDR to member addresses, bounded by limit.
func expandCIDREnrich(cidr string, limit int) []string {
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

// ipEnrichSubjects gathers the IPs to operate on: prior "ip" findings unioned
// with the job's seed Targets (which may include CIDRs). Every result is passed
// through the SSRF guard so private/reserved addresses are never touched.
func ipEnrichSubjects(in Input) []string {
	raw := dedupeAppend(append([]string{}, Subjects(in, TypeIP)...), roots(in))
	seen := map[string]bool{}
	out := make([]string, 0, len(raw))
	add := func(ip string) {
		ip = strings.TrimSpace(ip)
		if ip == "" || seen[ip] || isForbiddenScanIPEnrich(ip) {
			return
		}
		seen[ip] = true
		out = append(out, ip)
	}
	for _, part := range raw {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "/") {
			for _, ip := range expandCIDREnrich(part, 4096) {
				add(ip)
			}
			continue
		}
		if ip, err := netip.ParseAddr(part); err == nil {
			add(ip.String())
		}
	}
	return out
}

// ---- ip_enrichment_cached / ip_enrichment_fresh (geo + ASN via ip-api.com) ----

type ipEnrichTool struct{ name string }

func (t ipEnrichTool) Name() string { return t.name }

func (t ipEnrichTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := ipEnrichSubjects(in)
	out := Output{Raw: map[string]any{}}
	client := http.Client{Timeout: 3 * time.Second}
	for _, ip := range ips {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
			fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode,regionName,city,lat,lon,as,isp", ip),
			nil)
		resp, err := client.Do(req)
		if err != nil || resp == nil {
			continue // best-effort per IP
		}
		var payload map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&payload)
		_ = resp.Body.Close()
		if payload["status"] != "success" {
			continue
		}
		asn, asnOrg := "", ""
		if asnRaw, _ := payload["as"].(string); asnRaw != "" {
			parts := strings.SplitN(asnRaw, " ", 2)
			asn = parts[0]
			if len(parts) > 1 {
				asnOrg = parts[1]
			}
		}
		out.Findings = append(out.Findings, Finding{
			Type:   "ip_enrichment",
			Target: ip,
			Data: map[string]any{
				"country":      payload["country"],
				"country_code": payload["countryCode"],
				"region":       payload["regionName"],
				"city":         payload["city"],
				"latitude":     payload["lat"],
				"longitude":    payload["lon"],
				"asn":          asn,
				"asn_org":      asnOrg,
				"org":          asnOrg,
				"isp":          payload["isp"],
			},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- ip_whois_rdap / ip_whois_rdap_fresh (RDAP via rdap.org) ----

type ipRdapTool struct{ name string }

func (t ipRdapTool) Name() string { return t.name }

func (t ipRdapTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := ipEnrichSubjects(in)
	out := Output{Raw: map[string]any{}}
	client := http.Client{Timeout: 4 * time.Second}
	for _, ip := range ips {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://rdap.org/ip/"+ip, nil)
		resp, err := client.Do(req)
		if err != nil || resp == nil {
			continue
		}
		var payload map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&payload)
		_ = resp.Body.Close()
		out.Findings = append(out.Findings, Finding{
			Type:   "rdap",
			Target: ip,
			Name:   str(payload["name"]),
			Data: map[string]any{
				"name":         payload["name"],
				"country":      payload["country"],
				"startAddress": payload["startAddress"],
				"endAddress":   payload["endAddress"],
				"handle":       payload["handle"],
			},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- ip_relationship_map (shared /24 subnet + shared ASN clusters) ----

type ipRelationshipTool struct{}

func (ipRelationshipTool) Name() string { return "ip_relationship_map" }

func (ipRelationshipTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := ipEnrichSubjects(in)
	// Index prior enrichment findings (ip -> asn) so grouping uses real ASNs.
	asnByIP := map[string]string{}
	for _, f := range PriorFindings(in) {
		if f.Type != "ip_enrichment" || f.Target == "" {
			continue
		}
		if asn := strings.TrimSpace(str(f.Data["asn"])); asn != "" {
			asnByIP[f.Target] = asn
		}
	}
	rel := computeIPRelationshipsEnrich(ips, asnByIP)
	out := Output{Raw: rel}
	// One finding per multi-member cluster so downstream sees the relationship.
	if clusters, ok := rel["subnet_clusters"].([]map[string]any); ok {
		for _, c := range clusters {
			out.Findings = append(out.Findings, Finding{
				Type: "ip_relationship", Target: str(c["subnet"]),
				Data: map[string]any{"kind": "subnet", "members": c["members"], "count": c["count"]},
			})
		}
	}
	if clusters, ok := rel["asn_clusters"].([]map[string]any); ok {
		for _, c := range clusters {
			out.Findings = append(out.Findings, Finding{
				Type: "ip_relationship", Target: str(c["asn"]),
				Data: map[string]any{"kind": "asn", "members": c["members"], "count": c["count"]},
			})
		}
	}
	return out, nil
}

// computeIPRelationshipsEnrich builds real adjacency between IPs by grouping
// into shared /24 subnets and shared ASNs. Only groups with >1 member yield an
// edge set. Ported from service.go:computeIPRelationships.
func computeIPRelationshipsEnrich(ips []string, asnByIP map[string]string) map[string]any {
	subnetGroups := map[string][]string{}
	asnGroups := map[string][]string{}
	for _, ip := range ips {
		if subnet := slash24Enrich(ip); subnet != "" {
			subnetGroups[subnet] = append(subnetGroups[subnet], ip)
		}
		if asn := strings.TrimSpace(asnByIP[ip]); asn != "" {
			asnGroups[asn] = append(asnGroups[asn], ip)
		}
	}
	subnetClusters := make([]map[string]any, 0)
	for subnet, members := range subnetGroups {
		if len(members) < 2 {
			continue
		}
		sort.Strings(members)
		subnetClusters = append(subnetClusters, map[string]any{"subnet": subnet, "members": members, "count": len(members)})
	}
	sort.Slice(subnetClusters, func(a, b int) bool {
		return subnetClusters[a]["subnet"].(string) < subnetClusters[b]["subnet"].(string)
	})
	asnClusters := make([]map[string]any, 0)
	for asn, members := range asnGroups {
		if len(members) < 2 {
			continue
		}
		sort.Strings(members)
		asnClusters = append(asnClusters, map[string]any{"asn": asn, "members": members, "count": len(members)})
	}
	sort.Slice(asnClusters, func(a, b int) bool {
		return asnClusters[a]["asn"].(string) < asnClusters[b]["asn"].(string)
	})
	return map[string]any{
		"total_ips":       len(ips),
		"subnet_clusters": subnetClusters,
		"asn_clusters":    asnClusters,
	}
}

// slash24Enrich returns the /24 (IPv4) or /64 (IPv6) network string for an IP.
func slash24Enrich(ipStr string) string {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return ""
	}
	if v4 := ip.To4(); v4 != nil {
		return fmt.Sprintf("%d.%d.%d.0/24", v4[0], v4[1], v4[2])
	}
	mask := net.CIDRMask(64, 128)
	return (&net.IPNet{IP: ip.Mask(mask), Mask: mask}).String()
}

// ---- ip_exposure_score (deliberate no-op: scoring deferred to the API) ----

type ipExposureScoreTool struct{}

func (ipExposureScoreTool) Name() string { return "ip_exposure_score" }

func (ipExposureScoreTool) Run(ctx context.Context, in Input) (Output, error) {
	return Output{Raw: map[string]any{
		"note":         "scoring deferred to API exposure model (scoring/exposure.py)",
		"scored_by":    "scoring/exposure.py",
		"legacy_score": false,
	}}, nil
}

// ---- ip_findings_summary (small textual summary in Raw) ----

type ipFindingsSummaryTool struct{}

func (ipFindingsSummaryTool) Name() string { return "ip_findings_summary" }

func (ipFindingsSummaryTool) Run(ctx context.Context, in Input) (Output, error) {
	ips := ipEnrichSubjects(in)
	intensity := str(in.Params["intensity"])
	if intensity == "" {
		intensity = "configured"
	}
	return Output{Raw: map[string]any{
		"summary": fmt.Sprintf("IP discovery completed. %d hosts analyzed across %s intensity.", len(ips), intensity),
		"count":   len(ips),
	}}, nil
}

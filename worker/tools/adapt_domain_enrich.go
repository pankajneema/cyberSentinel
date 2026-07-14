package tools

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"worker/tools/httpx"
	"worker/tools/katana"
	"worker/tools/naabu"
	"worker/tools/nmap"
	"worker/tools/nuclei"
)

// ASM domain/service/cloud enrichment adapters, ported from the old
// backend/workers/services/asm/{executor.go,ip.go,service.go,domain.go}. Each
// self-registers under the tool name the PipelineConfig references and reuses the
// existing wrapper bodies (httpx, naabu, nmap, nuclei, katana) plus the direct
// ip-api.com/rdap.org HTTP calls the old code made. IP-scanning stages are guarded
// by the authoritative SSRF filter (isForbiddenScanIPEnrich, defined in
// adapt_ip_enrich.go) so private/link-local/metadata addresses are never touched.

func init() {
	Register(ipInfoTool{})
	Register(asnMapTool{})
	Register(apiSurfaceTool{})
	Register(backupDetectTool{})
	Register(httpBannerTool{})
	Register(topPortsServicesTool{})
	Register(deepMisconfigTool{})
	Register(configReviewTool{})
	Register(fullOsintTool{})
	Register(assetDiffTool{})
}

// enrichIPSubjects returns the prior "ip" targets to enrich, deduped and passed
// through the SSRF guard so internal/reserved addresses are never contacted.
func enrichIPSubjects(in Input) []string {
	seen := map[string]bool{}
	out := make([]string, 0)
	for _, ip := range Subjects(in, TypeIP) {
		ip = strings.TrimSpace(ip)
		if ip == "" || seen[ip] || isForbiddenScanIPEnrich(ip) {
			continue
		}
		seen[ip] = true
		out = append(out, ip)
	}
	return out
}

// ---- ipinfo (ip_info): geo/ASN enrichment over prior "ip" targets ----

type ipInfoTool struct{}

func (ipInfoTool) Name() string { return "ipinfo" }

func (ipInfoTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	for _, item := range geoEnrichEnrich(ctx, enrichIPSubjects(in)) {
		out.Findings = append(out.Findings, Finding{
			Type:   "geo",
			Target: str(item["ip"]),
			Name:   str(item["asn"]),
			Data:   item,
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// geoEnrichEnrich queries ip-api.com per IP exactly as ip.go:runIPGeoEnrichment.
func geoEnrichEnrich(ctx context.Context, ips []string) []map[string]any {
	client := http.Client{Timeout: 3 * time.Second}
	out := make([]map[string]any, 0, len(ips))
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
		out = append(out, map[string]any{
			"ip":           ip,
			"country":      payload["country"],
			"country_code": payload["countryCode"],
			"region":       payload["regionName"],
			"city":         payload["city"],
			"latitude":     payload["lat"],
			"longitude":    payload["lon"],
			"asn":          asn,
			"asn_org":      asnOrg,
			"isp":          payload["isp"],
		})
	}
	return out
}

// ---- asnmap (asn_map): aggregate discovered IPs into ASN groups ----

type asnMapTool struct{}

func (asnMapTool) Name() string { return "asnmap" }

func (asnMapTool) Run(ctx context.Context, in Input) (Output, error) {
	enrichment := geoEnrichEnrich(ctx, enrichIPSubjects(in))
	type asnAggregate struct {
		asnOrg    string
		ipCount   int
		countries map[string]bool
	}
	aggregates := map[string]*asnAggregate{}
	for _, item := range enrichment {
		asn, _ := item["asn"].(string)
		if asn == "" {
			continue
		}
		agg, exists := aggregates[asn]
		if !exists {
			agg = &asnAggregate{asnOrg: str(item["asn_org"]), countries: map[string]bool{}}
			aggregates[asn] = agg
		}
		agg.ipCount++
		if country, ok := item["country"].(string); ok && country != "" {
			agg.countries[country] = true
		}
	}
	out := Output{Raw: map[string]any{}}
	for asn, agg := range aggregates {
		countries := make([]string, 0, len(agg.countries))
		for c := range agg.countries {
			countries = append(countries, c)
		}
		out.Findings = append(out.Findings, Finding{
			Type:   "asn",
			Target: asn,
			Name:   agg.asnOrg,
			Data: map[string]any{
				"asn":       asn,
				"asn_org":   agg.asnOrg,
				"ip_count":  agg.ipCount,
				"countries": countries,
			},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- api_detector (api_surface_hint): crawl prior http hosts for API surface ----

type apiSurfaceTool struct{}

func (apiSurfaceTool) Name() string { return "api_detector" }

func (apiSurfaceTool) Run(ctx context.Context, in Input) (Output, error) {
	urls := Subjects(in, TypeHTTP)
	if len(urls) == 0 {
		urls = subdomains(in)
	}
	if len(urls) == 0 {
		return Output{Raw: map[string]any{"count": 0}}, nil
	}
	endpoints, err := katana.RunAPIDetection(ctx, urls)
	if err != nil {
		return Output{Raw: map[string]any{"note": "katana unavailable: " + err.Error()}}, nil
	}
	out := Output{Raw: map[string]any{}}
	for _, e := range endpoints {
		out.Findings = append(out.Findings, Finding{
			Type:   "endpoint",
			Target: e.URL,
			Name:   "api",
			Data:   map[string]any{"method": e.Method, "status": e.Status, "type": e.Type},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- backup_detector (backup_file_check): probe http hosts for exposed backups ----

type backupDetectTool struct{}

func (backupDetectTool) Name() string { return "backup_detector" }

func (backupDetectTool) Run(ctx context.Context, in Input) (Output, error) {
	hosts := Subjects(in, TypeHTTP)
	if len(hosts) == 0 {
		hosts = subdomains(in)
	}
	extensions := []string{".bak", ".backup", ".old", ".orig", ".save", ".swp", ".tmp", ".zip", ".tar.gz", ".sql"}
	basePaths := []string{"/backup", "/db", "/database", "/dump", "/site", "/website", "/www"}
	client := &http.Client{Timeout: 4 * time.Second}

	seen := map[string]bool{}
	out := Output{Raw: map[string]any{}}
	checked := 0
	for _, host := range hosts {
		host = hostOnlyDE(strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://"))
		if host == "" {
			continue
		}
		for _, scheme := range []string{"https://", "http://"} {
			baseURL := scheme + host
			for _, path := range basePaths {
				for _, ext := range extensions {
					candidate := baseURL + path + ext
					if seen[candidate] {
						continue
					}
					seen[candidate] = true
					checked++
					req, reqErr := http.NewRequestWithContext(ctx, http.MethodHead, candidate, nil)
					if reqErr != nil {
						continue
					}
					resp, err := client.Do(req)
					if err != nil {
						continue
					}
					_ = resp.Body.Close()
					// Keep only likely exposed artifacts.
					if resp.StatusCode >= 200 && resp.StatusCode < 400 {
						out.Findings = append(out.Findings, Finding{
							Type:     "endpoint",
							Target:   candidate,
							Name:     "backup_file",
							Severity: "medium",
							Data:     map[string]any{"extension": ext, "status": "accessible", "status_code": resp.StatusCode},
						})
					}
				}
			}
		}
	}
	out.Raw["count"] = len(out.Findings)
	out.Raw["checked"] = checked
	return out, nil
}

// ---- http_banner_check (service pipeline): HTTP banner over seed targets ----

type httpBannerTool struct{}

func (httpBannerTool) Name() string { return "http_banner_check" }

func (httpBannerTool) Run(ctx context.Context, in Input) (Output, error) {
	targets := serviceSeedTargetsDE(in)
	out := Output{Raw: map[string]any{}}
	for _, r := range runHTTPBannerCheckDE(ctx, targets) {
		out.Findings = append(out.Findings, Finding{
			Type:   TypeHTTP,
			Target: str(r["target"]),
			Name:   str(r["title"]),
			Data:   map[string]any{"status_code": r["status_code"], "https": r["https"], "server": r["server"]},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// serviceSeedTargetsDE resolves the service-scan targets from the job seeds,
// stripping schemes and dropping literal internal/reserved IPs via the SSRF
// guard (ported from service.go:buildServiceSeedTargets).
func serviceSeedTargetsDE(in Input) []string {
	seen := map[string]bool{}
	targets := make([]string, 0)
	for _, raw := range roots(in) {
		for _, part := range strings.FieldsFunc(strings.TrimSpace(raw), func(r rune) bool {
			return r == ',' || r == '\n' || r == '\t' || r == ' '
		}) {
			part = strings.TrimSpace(part)
			part = strings.TrimPrefix(strings.TrimPrefix(part, "https://"), "http://")
			part = strings.TrimSuffix(part, "/")
			if part == "" || seen[part] {
				continue
			}
			host := part
			if h, _, err := net.SplitHostPort(part); err == nil {
				host = h
			}
			if ip := net.ParseIP(host); ip != nil && isForbiddenScanIPEnrich(host) {
				continue
			}
			seen[part] = true
			targets = append(targets, part)
		}
	}
	return targets
}

// hostOnlyDE strips an optional :port suffix (service.go:hostOnly).
func hostOnlyDE(target string) string {
	if h, _, err := net.SplitHostPort(target); err == nil {
		return h
	}
	return target
}

// runHTTPBannerCheckDE prefers the httpx wrapper and falls back to a native probe
// (ported verbatim from service.go:runHTTPBannerCheck).
func runHTTPBannerCheckDE(ctx context.Context, targets []string) []map[string]any {
	out := make([]map[string]any, 0, len(targets))
	if len(targets) == 0 {
		return out
	}
	responses, err := httpx.RunHTTPStatus(ctx, targets)
	if err == nil && len(responses) > 0 {
		for _, r := range responses {
			out = append(out, map[string]any{
				"target": r.URL, "status_code": r.StatusCode, "https": r.HTTPS, "title": r.Title, "server": r.Server,
			})
		}
		return out
	}
	client := &http.Client{
		Timeout: 6 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig:   &tls.Config{InsecureSkipVerify: true}, // #nosec G402 - banner grab only
			DisableKeepAlives: true,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	for _, target := range targets {
		var got map[string]any
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
			got = map[string]any{
				"target": target, "status_code": resp.StatusCode, "https": scheme == "https", "title": "", "server": server,
			}
			break
		}
		if got == nil {
			got = map[string]any{"target": target, "status_code": 0, "https": false, "title": "", "server": ""}
		}
		out = append(out, got)
	}
	return out
}

// ---- top_ports_services (service pipeline): naabu top-ports + nmap fingerprint ----

type topPortsServicesTool struct{}

func (topPortsServicesTool) Name() string { return "top_ports_services" }

func (topPortsServicesTool) Run(ctx context.Context, in Input) (Output, error) {
	targets := serviceSeedTargetsDE(in)
	hosts := make([]string, 0, len(targets))
	for _, t := range targets {
		hosts = append(hosts, hostOnlyDE(t))
	}
	out := Output{Raw: map[string]any{}}
	if len(hosts) == 0 {
		return out, nil
	}
	// naabu wrapper self-falls-back to nmap when the naabu binary is absent.
	portResults, err := naabu.RunTopPortsScan(ctx, hosts)
	if err != nil {
		return Output{Raw: map[string]any{"note": "port scan unavailable: " + err.Error()}}, nil
	}
	portsByIP := map[string][]int{}
	for _, pr := range portResults {
		out.Findings = append(out.Findings, Finding{
			Type:   "port",
			Target: pr.IP,
			Data:   map[string]any{"port": pr.Port, "protocol": pr.Protocol},
		})
		if pr.Port > 0 {
			portsByIP[pr.IP] = append(portsByIP[pr.IP], pr.Port)
		}
	}
	// Service/version fingerprint over the discovered ports (nmap wrapper).
	for ip, ports := range portsByIP {
		svcs, svcErr := nmap.RunServiceDetection(ctx, []string{ip}, ports)
		if svcErr != nil {
			continue // best-effort per host
		}
		for _, s := range svcs {
			out.Findings = append(out.Findings, Finding{
				Type:   "service",
				Target: s.IP,
				Name:   s.Service,
				Data: map[string]any{
					"port": s.Port, "service": s.Service, "version": s.Version,
					"product": s.Product, "protocol": "tcp",
				},
			})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- deep_misconfig_analysis (service pipeline): nuclei over seed targets ----

type deepMisconfigTool struct{}

func (deepMisconfigTool) Name() string { return "deep_misconfig_analysis" }

func (deepMisconfigTool) Run(ctx context.Context, in Input) (Output, error) {
	targets := serviceSeedTargetsDE(in)
	out := Output{Raw: map[string]any{}}
	if len(targets) == 0 {
		return out, nil
	}
	findings, err := nuclei.Run(ctx, targets)
	if err != nil {
		return Output{Raw: map[string]any{"note": "nuclei unavailable: " + err.Error()}}, nil
	}
	for _, f := range findings {
		out.Findings = append(out.Findings, Finding{
			Type:     TypeVuln,
			Target:   f.Host,
			Name:     f.Name,
			Severity: f.Severity,
			Data:     map[string]any{"template_id": f.TemplateID, "matched_at": f.MatchedAt},
		})
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- config_review_readonly (cloud): keep only publicly-accessible resources ----

type configReviewTool struct{}

func (configReviewTool) Name() string { return "config_review_readonly" }

func (configReviewTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	for _, f := range PriorFindings(in) {
		if f.Type != "cloud" {
			continue
		}
		status := strings.ToLower(str(f.Data["exposure"]) + " " + str(f.Data["status"]))
		if strings.Contains(status, "public") || strings.Contains(status, "open") {
			out.Findings = append(out.Findings, f)
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- full_osint_correlation (cloud/human/repo): dedupe prior cloud resources ----

type fullOsintTool struct{}

func (fullOsintTool) Name() string { return "full_osint_correlation" }

func (fullOsintTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	seen := map[string]bool{}
	for _, f := range PriorFindings(in) {
		if f.Type != "cloud" {
			continue
		}
		if f.Target == "" || seen[f.Target] {
			continue
		}
		seen[f.Target] = true
		out.Findings = append(out.Findings, f)
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- asset_diff_engine (change_detection): unimplemented in source ----

type assetDiffTool struct{}

func (assetDiffTool) Name() string { return "asset_diff_engine" }

func (assetDiffTool) Run(ctx context.Context, in Input) (Output, error) {
	// The old executor.go had no change_detection implementation for domain
	// assets (the case was a no-op that always SKIPPed). Register it as an empty
	// completing stage rather than an error so the pipeline degrades gracefully.
	return Output{Raw: map[string]any{"note": "unimplemented in source; placeholder"}}, nil
}

package tools

import (
	"context"

	"worker/tools/ai/subdomainprobe"
	"worker/tools/amass"
	"worker/tools/bbot"
	"worker/tools/crtsh"
	"worker/tools/dnsgen"
	"worker/tools/dnsx"
	"worker/tools/httpprobe"
	"worker/tools/httpx"
	"worker/tools/nuclei"
	"worker/tools/subfinder"
)

// ASM domain-pipeline tool adapters. Each self-registers under the tool name the
// PipelineConfig references and reuses the existing wrapper body verbatim; only
// the wiring (which prior findings it reads, what finding Type it emits) lives
// here. Registering all of them happens automatically when package tools is
// imported (core imports it), so there is no giant switch and no blank-import list.

func init() {
	// Subdomain discovery: run a per-domain enumerator over the seed targets.
	Register(subdomainEnum{"subfinder", subfinder.Run})
	Register(subdomainEnum{"crtsh", crtsh.RunCertificateDiscovery})
	Register(subdomainEnum{"ai_subdomain_probe", subdomainprobe.Run})
	Register(subdomainEnum{"amass", amass.RunDeepDiscovery})
	Register(subdomainEnum{"bbot", bbot.RunRecursiveDiscovery})
	Register(dnsgenTool{})
	Register(dnsxTool{})
	Register(ipMappingTool{})
	Register(httpProbeTool{})
	Register(httpxTool{})
	Register(nucleiTool{})
}

// roots are the seed targets (root domains) for a job.
func roots(in Input) []string { return in.Targets }

// subdomains gathers every discovered subdomain plus the seed roots.
func subdomains(in Input) []string {
	return dedupeAppend(append([]string{}, Subjects(in, TypeSubdomain)...), roots(in))
}

// ---- subdomain enumerators (subfinder / crtsh / ai / amass / bbot) ----

type subdomainEnum struct {
	name string
	run  func(ctx context.Context, domain string) ([]string, error)
}

func (t subdomainEnum) Name() string { return t.name }

func (t subdomainEnum) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	seen := map[string]bool{}
	for _, d := range roots(in) {
		subs, err := t.run(ctx, d)
		if err != nil {
			continue // best-effort per domain; a single failure isn't fatal
		}
		for _, s := range subs {
			if s == "" || seen[s] {
				continue
			}
			seen[s] = true
			out.Findings = append(out.Findings, Finding{
				Type: TypeSubdomain, Target: s, Data: map[string]any{"source": t.name},
			})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- dnsgen: permutation expansion over discovered subdomains ----

type dnsgenTool struct{}

func (dnsgenTool) Name() string { return "dnsgen" }

func (dnsgenTool) Run(ctx context.Context, in Input) (Output, error) {
	seeds := Subjects(in, TypeSubdomain)
	if len(seeds) == 0 {
		seeds = roots(in)
	}
	cands, err := dnsgen.RunExpansion(ctx, seeds)
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"count": len(cands)}}
	for _, s := range cands {
		out.Findings = append(out.Findings, Finding{Type: TypeSubdomain, Target: s, Data: map[string]any{"source": "dnsgen"}})
	}
	return out, nil
}

// ---- dnsx: resolve subdomains → IPs ----

type dnsxTool struct{}

func (dnsxTool) Name() string { return "dnsx" }

func (dnsxTool) Run(ctx context.Context, in Input) (Output, error) {
	subs := subdomains(in)
	res, err := dnsx.RunDNSResolution(ctx, subs)
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"resolved": len(res)}}
	ipSeen := map[string]bool{}
	for sub, ips := range res {
		out.Findings = append(out.Findings, Finding{Type: TypeResolution, Target: sub, Data: map[string]any{"ips": ips}})
		for _, ip := range ips {
			if ip == "" || ipSeen[ip] {
				continue
			}
			ipSeen[ip] = true
			out.Findings = append(out.Findings, Finding{Type: TypeIP, Target: ip, Data: map[string]any{"subdomain": sub}})
		}
	}
	return out, nil
}

// ---- ip_mapping: root-domain → A records ----

type ipMappingTool struct{}

func (ipMappingTool) Name() string { return "ip_mapping" }

func (ipMappingTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	seen := map[string]bool{}
	for _, d := range roots(in) {
		ips, err := dnsx.RunIPMapping(ctx, d)
		if err != nil {
			continue
		}
		for _, ip := range ips {
			if ip == "" || seen[ip] {
				continue
			}
			seen[ip] = true
			out.Findings = append(out.Findings, Finding{Type: TypeIP, Target: ip, Data: map[string]any{"domain": d}})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// ---- http_probe: which subdomains are reachable ----

type httpProbeTool struct{}

func (httpProbeTool) Name() string { return "http_probe" }

func (httpProbeTool) Run(ctx context.Context, in Input) (Output, error) {
	reachable, err := httpprobe.RunReachabilityCheck(ctx, subdomains(in))
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"count": len(reachable)}}
	for _, h := range reachable {
		out.Findings = append(out.Findings, Finding{Type: TypeReachable, Target: h})
	}
	return out, nil
}

// ---- httpx: HTTP status/title/server/tech for reachable hosts ----

type httpxTool struct{}

func (httpxTool) Name() string { return "httpx" }

func (httpxTool) Run(ctx context.Context, in Input) (Output, error) {
	hosts := Subjects(in, TypeReachable)
	if len(hosts) == 0 {
		hosts = subdomains(in)
	}
	responses, err := httpx.RunHTTPStatus(ctx, hosts)
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"count": len(responses)}}
	for _, r := range responses {
		out.Findings = append(out.Findings, Finding{
			Type: TypeHTTP, Target: r.URL, Name: r.Title,
			Data: map[string]any{"status_code": r.StatusCode, "https": r.HTTPS, "server": r.Server},
		})
	}
	return out, nil
}

// ---- nuclei: vulnerability templates over discovered http hosts ----

type nucleiTool struct{}

func (nucleiTool) Name() string { return "nuclei" }

func (nucleiTool) Run(ctx context.Context, in Input) (Output, error) {
	hosts := Subjects(in, TypeHTTP)
	if len(hosts) == 0 {
		hosts = Subjects(in, TypeReachable)
	}
	if len(hosts) == 0 {
		hosts = subdomains(in)
	}
	findings, err := nuclei.Run(ctx, hosts)
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"count": len(findings)}}
	for _, f := range findings {
		out.Findings = append(out.Findings, Finding{
			Type: TypeVuln, Target: f.Host, Name: f.Name, Severity: f.Severity,
			Data: map[string]any{"template_id": f.TemplateID, "matched_at": f.MatchedAt, "cves": f.CVEs},
		})
	}
	return out, nil
}

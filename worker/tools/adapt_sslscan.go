package tools

import (
	"context"

	"worker/tools/sslscan"
)

func init() {
	Register(sslscanTool{})
}

// ---- ssl_analyzer: TLS/SSL certificate & cipher analysis over live hosts ----

type sslscanTool struct{}

func (sslscanTool) Name() string { return "ssl_analyzer" }

func (sslscanTool) Run(ctx context.Context, in Input) (Output, error) {
	hosts := Subjects(in, TypeHTTP)
	if len(hosts) == 0 {
		hosts = Subjects(in, TypeReachable)
	}
	if len(hosts) == 0 {
		hosts = subdomains(in)
	}
	results, err := sslscan.RunSSLAnalysis(ctx, hosts)
	if err != nil {
		return Output{}, err
	}
	out := Output{Raw: map[string]any{"count": len(results)}}
	for _, r := range results {
		out.Findings = append(out.Findings, Finding{
			Type:   "tls",
			Target: r.Host,
			Name:   r.Issuer,
			Data: map[string]any{
				"port":        r.Port,
				"protocol":    r.Protocol,
				"cipher":      r.Cipher,
				"certificate": r.Certificate,
				"issuer":      r.Issuer,
				"valid_until": r.ValidUntil,
			},
		})
	}
	return out, nil
}

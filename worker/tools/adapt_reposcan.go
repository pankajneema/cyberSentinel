package tools

import (
	"context"

	"worker/tools/reposcan"
)

func init() {
	Register(repoScanTool{})
}

// ---- repo_secret_scan: gitleaks over repo URLs / orgs from the seed roots ----

type repoScanTool struct{}

func (repoScanTool) Name() string { return "repo_secret_scan" }

func (repoScanTool) Run(ctx context.Context, in Input) (Output, error) {
	out := Output{Raw: map[string]any{}}
	for _, repo := range roots(in) {
		findings, err := reposcan.Run(ctx, repo)
		if err != nil {
			continue // best-effort per repo; skip a failing target
		}
		for _, f := range findings {
			// Never surface the raw (or even redacted) secret value; emit only
			// the rule/location metadata.
			data := map[string]any{}
			for k, v := range f {
				if k == "secret" {
					continue
				}
				data[k] = v
			}
			target := str(f["file_path"])
			if repoURL := str(f["repo_url"]); repoURL != "" {
				if target != "" {
					target = repoURL + ":" + target
				} else {
					target = repoURL
				}
			}
			out.Findings = append(out.Findings, Finding{
				Type:     "repo_secret",
				Target:   target,
				Name:     str(f["rule"]),
				Severity: str(f["severity"]),
				Data:     data,
			})
		}
	}
	out.Raw["count"] = len(out.Findings)
	return out, nil
}

// str coerces a map value to a string, returning "" for nil/non-string values.
func str(v any) string {
	s, _ := v.(string)
	return s
}

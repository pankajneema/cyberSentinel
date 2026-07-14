package crtsh

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// RunCertificateDiscovery queries crt.sh and extracts unique subdomains for a domain.
func RunCertificateDiscovery(ctx context.Context, domain string) ([]string, error) {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return nil, nil
	}

	endpoint := "https://crt.sh/?q=%25." + url.QueryEscape(domain) + "&output=json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("crt.sh request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("crt.sh returned status %d", resp.StatusCode)
	}

	var rows []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, fmt.Errorf("crt.sh decode failed: %w", err)
	}

	seen := make(map[string]bool)
	var out []string
	addCandidate := func(raw string) {
		for _, candidate := range strings.Split(raw, "\n") {
			candidate = strings.ToLower(strings.TrimSpace(candidate))
			candidate = strings.TrimPrefix(candidate, "*.")
			if candidate == "" || !strings.HasSuffix(candidate, domain) || seen[candidate] {
				continue
			}
			seen[candidate] = true
			out = append(out, candidate)
		}
	}

	for _, row := range rows {
		if nameValue, ok := row["name_value"].(string); ok {
			addCandidate(nameValue)
		}
		if commonName, ok := row["common_name"].(string); ok {
			addCandidate(commonName)
		}
	}

	return out, nil
}

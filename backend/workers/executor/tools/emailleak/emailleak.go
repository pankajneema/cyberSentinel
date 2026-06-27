// Package emailleak checks a domain/email for known breaches using the
// HaveIBeenPwned API. It is optional: without HIBP_API_KEY set, it returns an
// empty result without error so the pipeline skips the step cleanly.
package emailleak

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"workers/utils"
)

// hibpBreach mirrors the relevant fields of a HIBP breachedaccount entry.
type hibpBreach struct {
	Name        string   `json:"Name"`
	Title       string   `json:"Title"`
	PwnCount    int      `json:"PwnCount"`
	DataClasses []string `json:"DataClasses"`
	IsVerified  bool     `json:"IsVerified"`
}

// Run queries HIBP breachedaccount for the given account (domain or email).
// Returns empty (no error) when HIBP_API_KEY is unset.
func Run(ctx context.Context, account string) ([]map[string]interface{}, error) {
	if account == "" {
		return []map[string]interface{}{}, nil
	}

	apiKey := strings.TrimSpace(os.Getenv("HIBP_API_KEY"))
	if apiKey == "" {
		utils.Logger.Warnf("email_leak_check: HIBP_API_KEY not set, skipping account=%s", account)
		return []map[string]interface{}{}, nil
	}

	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	endpoint := fmt.Sprintf(
		"https://haveibeenpwned.com/api/v3/breachedaccount/%s?truncateResponse=false",
		url.PathEscape(account),
	)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build hibp request: %w", err)
	}
	req.Header.Set("hibp-api-key", apiKey)
	req.Header.Set("User-Agent", "cyberSentinel-ASM")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hibp request failed: %w", err)
	}
	defer resp.Body.Close()

	// 404 = no breaches found for this account.
	if resp.StatusCode == http.StatusNotFound {
		return []map[string]interface{}{}, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("hibp status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var breaches []hibpBreach
	if derr := json.NewDecoder(resp.Body).Decode(&breaches); derr != nil {
		return nil, fmt.Errorf("decode hibp response: %w", derr)
	}

	accounts := make([]map[string]interface{}, 0, len(breaches))
	for _, b := range breaches {
		source := b.Name
		if b.Title != "" {
			source = b.Title
		}
		accounts = append(accounts, map[string]interface{}{
			"email":        account,
			"source":       source,
			"breached":     true,
			"breach_count": b.PwnCount,
			"exposed_data": b.DataClasses,
			"severity":     severityFor(b.DataClasses),
		})
	}

	utils.Logger.Infof("email_leak_check: %d breach(es) for %s", len(accounts), account)
	return accounts, nil
}

// severityFor derives a severity from the exposed data classes.
func severityFor(dataClasses []string) string {
	for _, dc := range dataClasses {
		l := strings.ToLower(dc)
		if strings.Contains(l, "password") || strings.Contains(l, "credit") || strings.Contains(l, "ssn") || strings.Contains(l, "bank") {
			return "high"
		}
	}
	if len(dataClasses) > 2 {
		return "medium"
	}
	return "low"
}

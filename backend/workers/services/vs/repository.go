package vs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"workers/config"
)

// repository.go holds the VS service's external data access. VS has no direct
// SQL; its one data dependency is the just-in-time credential fetch from the
// core API's internal endpoint.

// credentialResponse mirrors the core API internal endpoint's JSON response.
// SECURITY: Secret holds a decrypted secret; instances live only inside
// fetchCredential and are never logged or marshaled back out.
type credentialResponse struct {
	CredType string `json:"cred_type"` // http_basic | http_form | ssh | bearer
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

// fetchCredential resolves an authenticated-scan credential just-in-time from
// the core API's INTERNAL endpoint, authenticating with the shared internal
// token (X-Internal-Token). It returns a *Credential held only in memory.
//
// SECURITY: this function never logs the secret (or the response body). Errors
// are constructed WITHOUT the secret so callers can log them safely.
func fetchCredential(ctx context.Context, cfg *config.Config, credentialID, orgID string) (*Credential, error) {
	if cfg.ControlPlaneToken == "" {
		return nil, fmt.Errorf("CONTROL_PLANE_TOKEN unset; cannot authenticate to credential endpoint")
	}
	if cfg.CoreAPIURL == "" {
		return nil, fmt.Errorf("CORE_API_URL unset; no credential endpoint configured")
	}

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	reqBody, err := json.Marshal(map[string]string{
		"credential_id": credentialID,
		"org_id":        orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal credential request: %w", err)
	}

	url := cfg.CoreAPIURL + "/api/v1/internal/vs/credential"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("build credential request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", cfg.ControlPlaneToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("credential endpoint request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Do not include the body: it could echo sensitive material.
		return nil, fmt.Errorf("credential endpoint returned status %d", resp.StatusCode)
	}

	var cr credentialResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return nil, fmt.Errorf("decode credential response: %w", err)
	}
	if cr.Secret == "" {
		return nil, fmt.Errorf("credential endpoint returned empty secret")
	}

	return &Credential{
		Type:     cr.CredType,
		Username: cr.Username,
		Secret:   cr.Secret,
	}, nil
}

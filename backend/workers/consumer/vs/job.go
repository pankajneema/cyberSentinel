// Package vs handles Vulnerability Scanning (VS) jobs consumed from jobs.vs.
//
// Unlike the ASM path (which forwards to the control-plane HTTP API), VS jobs
// are executed inline here: each target is scanned by every enabled engine
// adapter (executor/vs) and a single normalized result message is published to
// the report.vs queue for the reporting consumer to persist.
package vs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"workers/config"
	vsengine "workers/executor/vs"
	"workers/utils"
)

// perTargetTimeout bounds how long all engines may spend on a single target,
// independent of the overall job. Falls back if config is unavailable.
const perTargetTimeout = 5 * time.Minute

// ---- report.vs queue (lazy, process-wide, mirrors runner.InitReportQueue) ----

var (
	reportMu    sync.Mutex
	reportQueue *utils.Queue
)

// initReportQueue connects the report.vs queue once. Safe for concurrent calls
// from the consumer worker pool.
func initReportQueue(rabbitURL string) error {
	reportMu.Lock()
	defer reportMu.Unlock()
	if reportQueue != nil {
		return nil
	}
	q, err := utils.Connect(rabbitURL, "report.vs")
	if err != nil {
		return fmt.Errorf("failed to connect to report.vs queue: %w", err)
	}
	reportQueue = q
	utils.Logger.Info("report.vs queue initialized successfully")
	return nil
}

func publishReport(ctx context.Context, data []byte) error {
	reportMu.Lock()
	q := reportQueue
	reportMu.Unlock()
	if q == nil {
		return fmt.Errorf("report.vs queue not initialized")
	}
	publishCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return q.Publish(publishCtx, data)
}

// ---- VS job contract ----

type profileMsg struct {
	Engines           []string `json:"engines"`
	SafeMode          bool     `json:"safe_mode"`
	MaxRequestsPerSec int      `json:"max_requests_per_sec"`
	WebScan           bool     `json:"web_scan"`

	// Authenticated-scan controls. When Authenticated is true and CredentialID
	// is non-empty, the worker resolves the secret just-in-time from the core
	// API's internal endpoint before scanning.
	Authenticated bool   `json:"authenticated"`
	CredentialID  string `json:"credential_id"`
}

type targetMsg struct {
	AssetID string `json:"asset_id"`
	Host    string `json:"host"`
	URL     string `json:"url,omitempty"`
	Ports   []int  `json:"ports,omitempty"`
}

type jobMsg struct {
	Type    string      `json:"type"`
	ID      string      `json:"id"`      // scan_run_id
	ScanID  string      `json:"scan_id"` //
	OrgID   string      `json:"org_id"`
	Profile profileMsg  `json:"profile"`
	Targets []targetMsg `json:"targets"`
}

// ---- report.vs message contract ----

type targetResult struct {
	AssetID string `json:"asset_id"`
	Host    string `json:"host"`
	Status  string `json:"status"` // scanned | error
}

type reportMsg struct {
	ScanRunID      string                `json:"scan_run_id"`
	ScanID         string                `json:"scan_id"`
	OrgID          string                `json:"org_id"`
	Status         string                `json:"status"` // completed | failed
	Error          string                `json:"error"`
	EngineVersions map[string]string     `json:"engine_versions"`
	Targets        []targetResult        `json:"targets"`
	Findings       []vsengine.RawFinding `json:"findings"`
}

// HandleJob parses, executes, and reports a VS job. It returns nil once the
// result message is published (so the consumer ACKs), and a non-nil error only
// when publishing fails (so the consumer Nacks → DLQ). A target that fails to
// scan is recorded as status "error" but does not fail the whole job.
func HandleJob(body []byte) error {
	utils.Logger.Infof("[VS][QUEUE_RECEIVED] raw_body=%s", string(body))

	var job jobMsg
	if err := json.Unmarshal(body, &job); err != nil {
		utils.Logger.Errorf("[VS][INVALID_MESSAGE] error=%v raw_body=%s", err, string(body))
		return err
	}

	cfg := config.Load()
	if err := initReportQueue(cfg.RabbitURL); err != nil {
		utils.Logger.Errorf("[VS][REPORT_QUEUE_INIT_FAILED] scan_run_id=%s error=%v", job.ID, err)
		return err
	}

	// Overall job budget: honor TASK_TIMEOUT_SECONDS if configured.
	jobTimeout := time.Duration(cfg.TaskTimeoutSec) * time.Second
	if jobTimeout <= 0 {
		jobTimeout = 15 * time.Minute
	}
	jobCtx, cancelJob := context.WithTimeout(context.Background(), jobTimeout)
	defer cancelJob()

	profile := vsengine.Profile{
		Engines:  job.Profile.Engines,
		SafeMode: job.Profile.SafeMode,
		MaxRPS:   job.Profile.MaxRequestsPerSec,
		WebScan:  job.Profile.WebScan,
	}

	// Authenticated scan: resolve the credential just-in-time and hold it only in
	// memory on the Profile. Any failure degrades honestly to an unauthenticated
	// scan (the job is never failed for this). The secret is never logged.
	if job.Profile.Authenticated && job.Profile.CredentialID != "" {
		cred, err := fetchCredential(jobCtx, cfg, job.Profile.CredentialID, job.OrgID)
		if err != nil {
			utils.Logger.Warnf("[VS][AUTH_UNAVAILABLE] scan_run_id=%s credential_id=%s org_id=%s: authenticated scanning unavailable, proceeding UNAUTHENTICATED: %v",
				job.ID, job.Profile.CredentialID, job.OrgID, err)
		} else {
			profile.Credential = cred
			utils.Logger.Infof("[VS][AUTH_ENABLED] scan_run_id=%s credential_id=%s cred_type=%s",
				job.ID, job.Profile.CredentialID, cred.Type)
		}
	}

	scanners := vsengine.Registry()

	report := reportMsg{
		ScanRunID:      job.ID,
		ScanID:         job.ScanID,
		OrgID:          job.OrgID,
		Status:         "completed",
		Error:          "",
		EngineVersions: engineVersions(jobCtx, scanners, profile),
		Targets:        make([]targetResult, 0, len(job.Targets)),
		Findings:       make([]vsengine.RawFinding, 0),
	}

	for _, tm := range job.Targets {
		target := vsengine.Target{
			AssetID: tm.AssetID,
			Host:    tm.Host,
			URL:     tm.URL,
			Ports:   tm.Ports,
		}

		targetCtx, cancelTarget := context.WithTimeout(jobCtx, perTargetTimeout)

		findings, targetErr := scanTarget(targetCtx, scanners, target, profile, job.ID)
		cancelTarget()

		status := "scanned"
		if targetErr != nil {
			status = "error"
			utils.Logger.Warnf("[VS][TARGET_ERROR] scan_run_id=%s asset_id=%s host=%s error=%v",
				job.ID, tm.AssetID, tm.Host, targetErr)
		}
		report.Targets = append(report.Targets, targetResult{
			AssetID: tm.AssetID,
			Host:    tm.Host,
			Status:  status,
		})
		report.Findings = append(report.Findings, findings...)
	}

	data, err := json.Marshal(report)
	if err != nil {
		// Should not happen; surface as failure so the message dead-letters.
		utils.Logger.Errorf("[VS][MARSHAL_FAILED] scan_run_id=%s error=%v", job.ID, err)
		return err
	}

	if err := publishReport(jobCtx, data); err != nil {
		utils.Logger.Errorf("[VS][REPORT_PUBLISH_FAILED] scan_run_id=%s error=%v", job.ID, err)
		return err
	}

	utils.Logger.Infof("[VS][JOB_COMPLETED] scan_run_id=%s targets=%d findings=%d",
		job.ID, len(report.Targets), len(report.Findings))
	return nil
}

// credentialResponse mirrors the core API internal endpoint's JSON response.
// SECURITY: Secret holds a decrypted secret; instances live only inside
// fetchCredential and are never logged or marshaled back out.
type credentialResponse struct {
	CredType string `json:"cred_type"` // http_basic | http_form | ssh | bearer
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

// fetchCredential resolves an authenticated-scan credential just-in-time from
// the core API's INTERNAL endpoint, authenticating with the shared control-plane
// token. It returns a *vsengine.Credential held only in memory.
//
// SECURITY: this function never logs the secret (or the response body). Errors
// are constructed WITHOUT the secret so callers can log them safely.
func fetchCredential(ctx context.Context, cfg *config.Config, credentialID, orgID string) (*vsengine.Credential, error) {
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

	return &vsengine.Credential{
		Type:     cr.CredType,
		Username: cr.Username,
		Secret:   cr.Secret,
	}, nil
}

// scanTarget runs every enabled scanner against one target. Each adapter runs
// under its own recover() so a panicking/erroring engine cannot abort the
// target (or the job). Returns an error only if at least one enabled engine
// failed AND produced no findings — enough to mark the target "error".
func scanTarget(ctx context.Context, scanners []vsengine.Scanner, target vsengine.Target, profile vsengine.Profile, scanRunID string) (findings []vsengine.RawFinding, retErr error) {
	for _, s := range scanners {
		if !s.Enabled(profile) {
			continue
		}
		engineFindings, engineErr := runAdapter(ctx, s, target, profile, scanRunID)
		if engineErr != nil {
			// Record the first error; keep scanning other engines.
			if retErr == nil {
				retErr = engineErr
			}
			continue
		}
		findings = append(findings, engineFindings...)
	}
	return findings, retErr
}

// runAdapter invokes a single adapter with panic recovery.
func runAdapter(ctx context.Context, s vsengine.Scanner, target vsengine.Target, profile vsengine.Profile, scanRunID string) (findings []vsengine.RawFinding, err error) {
	defer func() {
		if r := recover(); r != nil {
			utils.Logger.Errorf("[VS][ADAPTER_PANIC] scan_run_id=%s engine=%s asset_id=%s: %v",
				scanRunID, s.Name(), target.AssetID, r)
			findings = nil
			err = fmt.Errorf("panic in engine %s: %v", s.Name(), r)
		}
	}()
	return s.Scan(ctx, target, profile)
}

// engineVersions best-effort collects a version string per enabled engine.
func engineVersions(ctx context.Context, scanners []vsengine.Scanner, profile vsengine.Profile) map[string]string {
	versions := map[string]string{}
	for _, s := range scanners {
		if !s.Enabled(profile) {
			continue
		}
		versions[s.Name()] = vsengine.EngineVersion(ctx, s.Name())
	}
	return versions
}

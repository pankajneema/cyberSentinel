package vs

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"workers/config"
	"workers/utils"
)

// ---- report.vs queue (lazy, process-wide) ----

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

// ---- VS job contract (jobs.vs envelope) ----

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
	ScanRunID      string            `json:"scan_run_id"`
	ScanID         string            `json:"scan_id"`
	OrgID          string            `json:"org_id"`
	Status         string            `json:"status"` // completed | failed
	Error          string            `json:"error"`
	EngineVersions map[string]string `json:"engine_versions"`
	Targets        []targetResult    `json:"targets"`
	Findings       []RawFinding      `json:"findings"`
}

// HandleJob parses, executes, and reports a VS job. It returns nil once the
// result message is published (so the consumer ACKs), and a non-nil error only
// when publishing fails (so the consumer Nacks → DLQ). A target that fails to
// scan is recorded as status "error" but does not fail the whole job.
func HandleJob(body []byte) error {
	var job jobMsg
	if err := json.Unmarshal(body, &job); err != nil {
		utils.Logger.Errorf("[VS][INVALID_MESSAGE] error=%v", err)
		return err
	}

	utils.Logger.Infof("[VS][QUEUE_RECEIVED] scan_run_id=%s type=%s targets=%d",
		job.ID, job.Type, len(job.Targets))

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

	profile := Profile{
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

	// Orchestrate the scan across all targets and assemble the report.
	report := runScan(jobCtx, Registry(), job, profile)

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

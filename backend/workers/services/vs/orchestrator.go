package vs

import (
	"context"
	"time"

	"workers/utils"
)

// perTargetTimeout bounds how long all engines may spend on a single target,
// independent of the overall job.
const perTargetTimeout = 5 * time.Minute

// runScan coordinates one VS job: it scans every target with the enabled
// engines and assembles the normalized report. A target that fails to scan is
// recorded as status "error" but does not fail the whole job. This is the VS
// orchestrator — the analogue of the ASM orchestration that drives the pipeline
// and collects results before the report is published.
func runScan(ctx context.Context, scanners []Scanner, job jobMsg, profile Profile) reportMsg {
	report := reportMsg{
		ScanRunID:      job.ID,
		ScanID:         job.ScanID,
		OrgID:          job.OrgID,
		Status:         "completed",
		Error:          "",
		EngineVersions: engineVersions(ctx, scanners, profile),
		Targets:        make([]targetResult, 0, len(job.Targets)),
		Findings:       make([]RawFinding, 0),
	}

	for _, tm := range job.Targets {
		target := Target{
			AssetID: tm.AssetID,
			Host:    tm.Host,
			URL:     tm.URL,
			Ports:   tm.Ports,
		}

		targetCtx, cancelTarget := context.WithTimeout(ctx, perTargetTimeout)
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

	return report
}

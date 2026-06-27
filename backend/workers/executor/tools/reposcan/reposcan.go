// Package reposcan scans a git repository for leaked secrets using the
// `gitleaks` binary when it is available. The step is optional: if gitleaks
// (or git) is not installed, it returns an empty result without error so the
// pipeline skips the step cleanly.
package reposcan

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"workers/utils"
)

// Finding represents a single leaked-secret finding emitted to the report layer.
type Finding struct {
	RepoURL     string `json:"repo_url"`
	FindingType string `json:"finding_type"`
	Rule        string `json:"rule"`
	Severity    string `json:"severity"`
	FilePath    string `json:"file_path"`
	Line        int    `json:"line"`
	Secret      string `json:"secret"`
	Commit      string `json:"commit"`
}

// gitleaksReport mirrors the relevant fields of gitleaks JSON report entries.
type gitleaksReport struct {
	RuleID      string `json:"RuleID"`
	Description string `json:"Description"`
	Secret      string `json:"Secret"`
	File        string `json:"File"`
	StartLine   int    `json:"StartLine"`
	Commit      string `json:"Commit"`
}

// Run clones the repo (best-effort) and runs gitleaks against it. Returns an
// empty slice (no error) when gitleaks/git are absent so the step is optional.
func Run(ctx context.Context, repo string) ([]map[string]interface{}, error) {
	if repo == "" {
		return []map[string]interface{}{}, nil
	}

	repoURL := normalizeRepoURL(repo)

	gitleaksPath, err := getToolPath("gitleaks")
	if err != nil {
		utils.Logger.Warnf("repo_secret_scan: gitleaks not found, skipping repo=%s", repoURL)
		return []map[string]interface{}{}, nil
	}

	// Try to clone into a temp dir so gitleaks can scan history.
	source := ""
	tmpDir := ""
	if gitPath, gerr := getToolPath("git"); gerr == nil {
		td, terr := os.MkdirTemp("", "reposcan-*")
		if terr == nil {
			tmpDir = td
			defer os.RemoveAll(tmpDir)

			cloneCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
			defer cancel()
			clone := exec.CommandContext(cloneCtx, gitPath, "clone", "--depth", "1", repoURL, tmpDir)
			if out, cerr := clone.CombinedOutput(); cerr != nil {
				utils.Logger.Warnf("repo_secret_scan: clone failed repo=%s err=%v out=%s", repoURL, cerr, strings.TrimSpace(string(out)))
			} else {
				source = tmpDir
			}
		}
	}

	if source == "" {
		// No clone available; gitleaks cannot scan a remote URL directly.
		utils.Logger.Warnf("repo_secret_scan: no local clone for repo=%s, skipping", repoURL)
		return []map[string]interface{}{}, nil
	}

	reportFile := filepath.Join(tmpDir, "gitleaks-report.json")
	scanCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()

	cmd := exec.CommandContext(scanCtx, gitleaksPath, "detect",
		"--source", source,
		"--report-format", "json",
		"--report-path", reportFile,
		"--exit-code", "0",
		"--no-banner",
	)
	if out, rerr := cmd.CombinedOutput(); rerr != nil {
		utils.Logger.Warnf("repo_secret_scan: gitleaks run issue repo=%s err=%v out=%s", repoURL, rerr, strings.TrimSpace(string(out)))
	}

	data, rerr := os.ReadFile(reportFile)
	if rerr != nil {
		utils.Logger.Warnf("repo_secret_scan: no report produced repo=%s err=%v", repoURL, rerr)
		return []map[string]interface{}{}, nil
	}

	var raw []gitleaksReport
	if jerr := json.Unmarshal(data, &raw); jerr != nil {
		return nil, fmt.Errorf("parse gitleaks report: %w", jerr)
	}

	findings := make([]map[string]interface{}, 0, len(raw))
	for _, r := range raw {
		rule := r.RuleID
		if rule == "" {
			rule = r.Description
		}
		findings = append(findings, map[string]interface{}{
			"repo_url":     repoURL,
			"finding_type": "secret",
			"rule":         rule,
			"severity":     "high",
			"file_path":    r.File,
			"line":         r.StartLine,
			"secret":       redactSecret(r.Secret),
			"commit":       r.Commit,
		})
	}

	utils.Logger.Infof("repo_secret_scan: %d secret(s) found repo=%s", len(findings), repoURL)
	return findings, nil
}

// normalizeRepoURL turns "github.com/org/repo" into a clonable https URL.
func normalizeRepoURL(repo string) string {
	r := strings.TrimSpace(repo)
	if strings.HasPrefix(r, "http://") || strings.HasPrefix(r, "https://") || strings.HasPrefix(r, "git@") {
		return r
	}
	return "https://" + r
}

// redactSecret keeps only a short prefix to avoid storing raw secrets.
func redactSecret(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) <= 4 {
		return "****"
	}
	return s[:4] + strings.Repeat("*", 8)
}

func getToolPath(toolName string) (string, error) {
	if path, err := exec.LookPath(toolName); err == nil {
		return path, nil
	}
	commonPaths := []string{
		filepath.Join("/usr", "local", "bin", toolName),
		filepath.Join("/usr", "bin", toolName),
	}
	for _, path := range commonPaths {
		if info, err := os.Stat(path); err == nil {
			if info.Mode().Perm()&0111 != 0 {
				return path, nil
			}
		}
	}
	return "", fmt.Errorf("tool '%s' not found in PATH or common locations", toolName)
}

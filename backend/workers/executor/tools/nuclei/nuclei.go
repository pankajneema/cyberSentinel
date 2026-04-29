package nuclei

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Finding struct {
	Host       string `json:"host"`
	MatchedAt  string `json:"matched_at,omitempty"`
	TemplateID string `json:"template_id,omitempty"`
	Name       string `json:"name,omitempty"`
	Severity   string `json:"severity,omitempty"`
}

func getToolPath(toolName string) (string, error) {
	if path, err := exec.LookPath(toolName); err == nil {
		return path, nil
	}

	homeDir, _ := os.UserHomeDir()
	commonPaths := []string{
		filepath.Join(homeDir, "go", "bin", toolName),
		filepath.Join("/usr", "local", "bin", toolName),
		filepath.Join("/usr", "bin", toolName),
	}
	for _, path := range commonPaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("tool %q not found", toolName)
}

// Run scans the provided hosts with nuclei and returns parsed findings.
func Run(ctx context.Context, hosts []string) ([]Finding, error) {
	if len(hosts) == 0 {
		return nil, nil
	}

	toolPath, err := getToolPath("nuclei")
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, toolPath, "-silent", "-jsonl", "-duc", "-list", "-")
	cmd.Stdin = strings.NewReader(strings.Join(hosts, "\n"))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	var findings []Finding
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			continue
		}

		finding := Finding{}
		if host, ok := payload["host"].(string); ok {
			finding.Host = host
		}
		if matchedAt, ok := payload["matched-at"].(string); ok {
			finding.MatchedAt = matchedAt
		}
		if templateID, ok := payload["template-id"].(string); ok {
			finding.TemplateID = templateID
		}
		if info, ok := payload["info"].(map[string]interface{}); ok {
			if name, ok := info["name"].(string); ok {
				finding.Name = name
			}
			if severity, ok := info["severity"].(string); ok {
				finding.Severity = severity
			}
		}
		findings = append(findings, finding)
	}

	if err := cmd.Wait(); err != nil && len(findings) == 0 {
		return nil, err
	}
	return findings, nil
}

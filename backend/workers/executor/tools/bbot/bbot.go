package bbot

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

func getToolPath(toolName string) (string, error) {
	if path, err := exec.LookPath(toolName); err == nil {
		return path, nil
	}

	homeDir, _ := os.UserHomeDir()
	commonPaths := []string{
		filepath.Join(homeDir, ".local", "bin", toolName),
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

// RunRecursiveDiscovery executes bbot and extracts discovered subdomains from stdout.
func RunRecursiveDiscovery(ctx context.Context, domain string) ([]string, error) {
	toolPath, err := getToolPath("bbot")
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, toolPath, "-t", domain, "-f", "subdomain-enum")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	re := regexp.MustCompile(`([a-zA-Z0-9_-]+\.)+` + regexp.QuoteMeta(domain))
	seen := make(map[string]bool)
	var out []string
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		matches := re.FindAllString(strings.ToLower(scanner.Text()), -1)
		for _, match := range matches {
			match = strings.TrimSpace(strings.Trim(match, ".,"))
			if match != "" && !seen[match] {
				seen[match] = true
				out = append(out, match)
			}
		}
	}

	if err := cmd.Wait(); err != nil && len(out) == 0 {
		return nil, err
	}
	return out, nil
}

package httpprobe

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"strings"

	"workers/utils"
)

// RunReachabilityCheck checks HTTP/HTTPS reachability for given subdomains
// Returns list of reachable subdomains
func RunReachabilityCheck(ctx context.Context, subdomains []string) ([]string, error) {
	if len(subdomains) == 0 {
		return []string{}, nil
	}

	utils.Logger.Infof("running http_probe reachability check for %d subdomains", len(subdomains))

	// Create input file content
	input := strings.Join(subdomains, "\n")

	httprobePath, err := utils.LookPath("httprobe")
	if err != nil {
		return nil, fmt.Errorf("failed to find httprobe tool: %w", err)
	}

	cmd := exec.CommandContext(
		ctx,
		httprobePath,
		"-c", "50", // Concurrency
		"-t", "5000", // Timeout in ms
	)

	cmd.Stdin = strings.NewReader(input)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start httprobe: %w", err)
	}

	var reachable []string
	seen := make(map[string]bool)
	scanner := bufio.NewScanner(stdout)

	for scanner.Scan() {
		url := strings.TrimSpace(scanner.Text())
		if url != "" {
			// Extract subdomain from URL (remove http:// or https://)
			url = strings.TrimPrefix(url, "http://")
			url = strings.TrimPrefix(url, "https://")
			// Remove port if present
			if idx := strings.Index(url, ":"); idx != -1 {
				url = url[:idx]
			}
			// Remove path if present
			if idx := strings.Index(url, "/"); idx != -1 {
				url = url[:idx]
			}
			if !seen[url] {
				reachable = append(reachable, url)
				seen[url] = true
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		// Some failures are expected
		utils.Logger.Warnf("httprobe completed with some failures: %v", err)
	}

	utils.Logger.Infof("httprobe found %d/%d reachable subdomains", len(reachable), len(subdomains))
	return reachable, nil
}

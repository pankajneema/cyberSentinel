package httpprobe

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"workers/utils"
)

// getToolPath finds the tool executable in PATH or common locations
func getToolPath(toolName string) (string, error) {
	// First try PATH
	if path, err := exec.LookPath(toolName); err == nil {
		utils.Logger.Debugf("found %s in PATH: %s", toolName, path)
		return path, nil
	}

	// Try Go bin directory from GOPATH env
	if goPath := os.Getenv("GOPATH"); goPath != "" {
		toolPath := filepath.Join(goPath, "bin", toolName)
		if _, err := os.Stat(toolPath); err == nil {
			utils.Logger.Debugf("found %s in GOPATH/bin: %s", toolName, toolPath)
			return toolPath, nil
		}
	}

	// Try common Go bin locations
	homeDir, _ := os.UserHomeDir()
	commonPaths := []string{
		filepath.Join(homeDir, "go", "bin", toolName),
		filepath.Join("/home", "anonymous", "go", "bin", toolName),
		filepath.Join("/usr", "local", "bin", toolName),
		filepath.Join("/usr", "bin", toolName),
	}

	for _, path := range commonPaths {
		if info, err := os.Stat(path); err == nil {
			if info.Mode().Perm()&0111 != 0 {
				utils.Logger.Debugf("found %s at: %s", toolName, path)
				return path, nil
			}
		}
	}

	return "", fmt.Errorf("tool '%s' not found in PATH or common locations", toolName)
}

// RunReachabilityCheck checks HTTP/HTTPS reachability for given subdomains
// Returns list of reachable subdomains
func RunReachabilityCheck(ctx context.Context, subdomains []string) ([]string, error) {
	if len(subdomains) == 0 {
		return []string{}, nil
	}

	utils.Logger.Infof("running http_probe reachability check for %d subdomains", len(subdomains))

	// Create input file content
	input := strings.Join(subdomains, "\n")

	httprobePath, err := getToolPath("httprobe")
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
			reachable = append(reachable, url)
		}
	}

	if err := cmd.Wait(); err != nil {
		// Some failures are expected
		utils.Logger.Warnf("httprobe completed with some failures: %v", err)
	}

	utils.Logger.Infof("httprobe found %d/%d reachable subdomains", len(reachable), len(subdomains))
	return reachable, nil
}


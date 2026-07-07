package httpx

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"workers/utils"
)

// HTTPResponse represents HTTP response data
type HTTPResponse struct {
	URL        string `json:"url"`
	StatusCode int    `json:"status_code"`
	HTTPS      bool   `json:"https"`
	Title      string `json:"title,omitempty"`
	Server     string `json:"server,omitempty"`
}

// RunHTTPStatus checks HTTP status for given subdomains
// Returns list of HTTPResponse objects
func RunHTTPStatus(ctx context.Context, subdomains []string) ([]HTTPResponse, error) {
	if len(subdomains) == 0 {
		return []HTTPResponse{}, nil
	}

	utils.Logger.Infof("running httpx status check for %d subdomains", len(subdomains))

	// Create input file content
	input := strings.Join(subdomains, "\n")

	httpxPath, err := utils.LookPath("httpx")
	if err != nil {
		return nil, fmt.Errorf("failed to find httpx tool: %w", err)
	}

	cmd := exec.CommandContext(
		ctx,
		httpxPath,
		"-l", "-", // Read from stdin
		"-status-code",   // Include status code
		"-title",         // Include page title
		"-server",        // Include server header
		"-tech-detect",   // Technology detection
		"-json",          // JSON output
		"-timeout", "10", // Timeout in seconds
		"-retries", "1", // Retry once
	)

	cmd.Stdin = strings.NewReader(input)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start httpx: %w", err)
	}

	var responses []HTTPResponse
	scanner := bufio.NewScanner(stdout)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var data map[string]interface{}
		if err := json.Unmarshal([]byte(line), &data); err != nil {
			utils.Logger.Warnf("failed to parse httpx JSON line: %s", line)
			continue
		}

		url, _ := data["url"].(string)
		if url == "" {
			continue
		}

		// Extract subdomain from URL
		subdomain := strings.TrimPrefix(url, "http://")
		subdomain = strings.TrimPrefix(subdomain, "https://")
		if idx := strings.Index(subdomain, "/"); idx != -1 {
			subdomain = subdomain[:idx]
		}
		if idx := strings.Index(subdomain, ":"); idx != -1 {
			subdomain = subdomain[:idx]
		}

		statusCode := 0
		if sc, ok := data["status_code"].(float64); ok {
			statusCode = int(sc)
		}

		https := strings.HasPrefix(url, "https://")
		title, _ := data["title"].(string)
		server, _ := data["server"].(string)

		responses = append(responses, HTTPResponse{
			URL:        subdomain,
			StatusCode: statusCode,
			HTTPS:      https,
			Title:      title,
			Server:     server,
		})
	}

	if err := cmd.Wait(); err != nil {
		// Some failures are expected
		utils.Logger.Warnf("httpx completed with some failures: %v", err)
	}

	utils.Logger.Infof("httpx checked %d subdomains", len(responses))
	return responses, nil
}

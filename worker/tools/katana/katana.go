package katana

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"

	"worker/utils"
)

// APIEndpoint represents a discovered API endpoint
type APIEndpoint struct {
	URL    string `json:"url"`
	Method string `json:"method,omitempty"`
	Status int    `json:"status,omitempty"`
	Type   string `json:"type,omitempty"` // api, endpoint, etc.
}

// RunAPIDetection discovers API endpoints
func RunAPIDetection(ctx context.Context, urls []string) ([]APIEndpoint, error) {
	if len(urls) == 0 {
		return []APIEndpoint{}, nil
	}

	toolPath, err := utils.LookPath("katana")
	if err != nil {
		// Fallback to api_detector wrapper
		toolPath, err = utils.LookPath("api_detector")
		if err != nil {
			utils.Logger.Warnf("katana/api_detector not found: %v - API detection will be skipped", err)
			// Return empty results instead of error to allow pipeline to continue
			return []APIEndpoint{}, nil
		}
	}

	var results []APIEndpoint

	for _, url := range urls {
		// Ensure URL has protocol
		if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
			url = "https://" + url
		}

		// Run katana
		utils.Logger.Debugf("katana: crawling %s", url)
		cmd := exec.CommandContext(ctx, toolPath,
			"-u", url,
			"-silent",
			"-json",
			"-depth", "2",
		)

		output, err := cmd.CombinedOutput()
		utils.Logger.Debugf("katana: raw output for %s (first 500 chars): %s", url, string(output)[:min(500, len(string(output)))])

		if err != nil {
			utils.Logger.Warnf("katana failed for %s: %v, output length: %d", url, err, len(output))
			// Continue even if error - might have partial results
		}

		// Parse JSON output
		lines := strings.Split(string(output), "\n")
		utils.Logger.Debugf("katana: parsed %d lines from output for %s", len(lines), url)

		for idx, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			var result map[string]interface{}
			if err := json.Unmarshal([]byte(line), &result); err != nil {
				utils.Logger.Debugf("katana: failed to parse line %d for %s: %s, error: %v", idx, url, line, err)
				continue
			}

			endpointURL, _ := result["url"].(string)
			if endpointURL == "" {
				continue
			}

			// Check if it's an API endpoint
			if strings.Contains(endpointURL, "/api/") ||
				strings.Contains(endpointURL, "/v1/") ||
				strings.Contains(endpointURL, "/v2/") ||
				strings.Contains(endpointURL, "/graphql") ||
				strings.Contains(endpointURL, "/rest/") {
				status, _ := result["status_code"].(float64)
				method, _ := result["method"].(string)

				results = append(results, APIEndpoint{
					URL:    endpointURL,
					Method: method,
					Status: int(status),
					Type:   "api",
				})
			}
		}
	}

	utils.Logger.Infof("API detection completed: found %d endpoints", len(results))
	return results, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

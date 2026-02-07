package katana

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"workers/utils"
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

	toolPath, err := getToolPath("katana")
	if err != nil {
		// Fallback to api_detector wrapper
		toolPath, err = getToolPath("api_detector")
		if err != nil {
			return nil, fmt.Errorf("katana/api_detector not found: %v", err)
		}
	}

	var results []APIEndpoint

	for _, url := range urls {
		// Ensure URL has protocol
		if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
			url = "https://" + url
		}

		// Run katana
		cmd := exec.CommandContext(ctx, toolPath,
			"-u", url,
			"-silent",
			"-json",
			"-depth", "2",
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			utils.Logger.Warnf("katana failed for %s: %v", url, err)
			continue
		}

		// Parse JSON output
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			var result map[string]interface{}
			if err := json.Unmarshal([]byte(line), &result); err != nil {
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

func getToolPath(toolName string) (string, error) {
	if path, err := exec.LookPath(toolName); err == nil {
		utils.Logger.Debugf("found %s in PATH: %s", toolName, path)
		return path, nil
	}
	if goPath := os.Getenv("GOPATH"); goPath != "" {
		toolPath := filepath.Join(goPath, "bin", toolName)
		if _, err := os.Stat(toolPath); err == nil {
			utils.Logger.Debugf("found %s in GOPATH/bin: %s", toolName, toolPath)
			return toolPath, nil
		}
	}
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


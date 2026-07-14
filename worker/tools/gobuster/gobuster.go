package gobuster

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"worker/utils"
)

// AdminEndpoint represents a discovered admin endpoint
type AdminEndpoint struct {
	URL    string `json:"url"`
	Status int    `json:"status"`
	Size   int64  `json:"size,omitempty"`
}

// RunAdminFinder discovers admin endpoints
func RunAdminFinder(ctx context.Context, urls []string) ([]AdminEndpoint, error) {
	if len(urls) == 0 {
		return []AdminEndpoint{}, nil
	}

	toolPath, err := utils.LookPath("gobuster")
	if err != nil {
		// Fallback to admin_finder wrapper
		toolPath, err = utils.LookPath("admin_finder")
		if err != nil {
			return nil, fmt.Errorf("gobuster/admin_finder not found: %v", err)
		}
	}

	var results []AdminEndpoint

	for _, url := range urls {
		// Ensure URL has protocol
		if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
			url = "https://" + url
		}

		// Common admin paths
		adminPaths := []string{"admin", "administrator", "login", "dashboard", "panel", "wp-admin", "admin.php"}

		for _, path := range adminPaths {
			testURL := strings.TrimSuffix(url, "/") + "/" + path

			// Run gobuster (or use curl as fallback)
			cmd := exec.CommandContext(ctx, toolPath, "dir",
				"-u", url,
				"-w", "/dev/stdin",
				"-q",
			)
			cmd.Stdin = strings.NewReader(path)

			output, err := cmd.CombinedOutput()
			if err != nil {
				continue
			}

			// Parse gobuster output
			outputStr := string(output)
			if strings.Contains(outputStr, "Status: 200") || strings.Contains(outputStr, "Status: 301") || strings.Contains(outputStr, "Status: 302") {
				results = append(results, AdminEndpoint{
					URL:    testURL,
					Status: 200,
				})
			}
		}
	}

	utils.Logger.Infof("admin finder completed: found %d endpoints", len(results))
	return results, nil
}

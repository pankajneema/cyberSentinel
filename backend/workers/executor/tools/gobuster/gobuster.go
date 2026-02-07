package gobuster

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"workers/utils"
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

	toolPath, err := getToolPath("gobuster")
	if err != nil {
		// Fallback to admin_finder wrapper
		toolPath, err = getToolPath("admin_finder")
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


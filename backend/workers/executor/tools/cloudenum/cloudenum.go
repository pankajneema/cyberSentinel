package cloudenum

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"workers/utils"
)

// CloudResource represents a discovered cloud resource
type CloudResource struct {
	Service string `json:"service"` // AWS, Azure, GCP
	Type    string `json:"type"`    // S3 bucket, storage account, etc.
	Name    string `json:"name"`
	Status  string `json:"status"` // public, private, etc.
}

// RunCloudOSINT discovers cloud resources
func RunCloudOSINT(ctx context.Context, domain string) ([]CloudResource, error) {
	if domain == "" {
		return []CloudResource{}, nil
	}

	toolPath, err := getToolPath("cloud_enum")
	if err != nil {
		// Fallback to cloud_osint wrapper
		toolPath, err = getToolPath("cloud_osint")
		if err != nil {
			return nil, fmt.Errorf("cloud_enum/cloud_osint not found: %v", err)
		}
	}

	// Run cloud_enum
	cmd := exec.CommandContext(ctx, toolPath, "-k", domain)
	output, err := cmd.CombinedOutput()
	if err != nil {
		utils.Logger.Warnf("cloud_enum failed for %s: %v", domain, err)
	}

	var results []CloudResource
	outputStr := string(output)
	lines := strings.Split(outputStr, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Parse cloud_enum output (format varies)
		// Example: "[+] s3-bucket-name (public)"
		if strings.Contains(line, "[+]") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				name := parts[1]
				status := "unknown"
				if strings.Contains(line, "public") {
					status = "public"
				} else if strings.Contains(line, "private") {
					status = "private"
				}

				service := "unknown"
				if strings.Contains(line, "s3") || strings.Contains(name, "s3") {
					service = "AWS"
					results = append(results, CloudResource{
						Service: service,
						Type:    "S3",
						Name:    name,
						Status:  status,
					})
				} else if strings.Contains(line, "azure") || strings.Contains(name, "azure") {
					service = "Azure"
					results = append(results, CloudResource{
						Service: service,
						Type:    "Storage",
						Name:    name,
						Status:  status,
					})
				}
			}
		}
	}

	utils.Logger.Infof("cloud OSINT completed: found %d resources", len(results))
	return results, nil
}

func getToolPath(toolName string) (string, error) {
	if path, err := exec.LookPath(toolName); err == nil {
		utils.Logger.Debugf("found %s in PATH: %s", toolName, path)
		return path, nil
	}
	commonPaths := []string{
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


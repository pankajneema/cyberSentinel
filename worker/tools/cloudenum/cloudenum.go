package cloudenum

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"worker/utils"
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

	toolPath, err := utils.LookPath("cloud_enum")
	if err != nil {
		// Fallback to cloud_osint wrapper
		toolPath, err = utils.LookPath("cloud_osint")
		if err != nil {
			return nil, fmt.Errorf("cloud_enum/cloud_osint not found: %v", err)
		}
	}

	// Run cloud_enum
	cmd := exec.CommandContext(ctx, toolPath, "-k", domain)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// A non-zero exit means the tool never produced real output (e.g. a
		// Python traceback from a broken install) — propagate the failure
		// instead of parsing that output as if it were valid results, which
		// previously made a crashed tool indistinguishable from "ran cleanly,
		// found nothing."
		return nil, fmt.Errorf("cloud_enum/cloud_osint (%s) failed for %q: %w — output: %s",
			toolPath, domain, err, strings.TrimSpace(string(output)))
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

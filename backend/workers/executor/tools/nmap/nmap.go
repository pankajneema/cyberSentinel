package nmap

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"workers/utils"
)

// ServiceResult represents a discovered service
type ServiceResult struct {
	IP      string `json:"ip"`
	Port    int    `json:"port"`
	Service string `json:"service"`
	Version string `json:"version,omitempty"`
	Product string `json:"product,omitempty"`
}

// RunServiceDetection detects services on given IPs and ports
func RunServiceDetection(ctx context.Context, ips []string, ports []int) ([]ServiceResult, error) {
	if len(ips) == 0 {
		return []ServiceResult{}, nil
	}

	toolPath, err := getToolPath("nmap")
	if err != nil {
		// Fallback to service_detector wrapper
		toolPath, err = getToolPath("service_detector")
		if err != nil {
			return nil, fmt.Errorf("nmap/service_detector not found: %v", err)
		}
	}

	var results []ServiceResult

	// Run nmap for each IP (or batch if possible)
	for _, ip := range ips {
		var portSpec string
		if len(ports) > 0 {
			portList := make([]string, len(ports))
			for i, p := range ports {
				portList[i] = fmt.Sprintf("%d", p)
			}
			portSpec = strings.Join(portList, ",")
		} else {
			portSpec = "1-1000" // Default top ports
		}

		// Run nmap with service detection
		cmd := exec.CommandContext(ctx, toolPath,
			"-sV",
			"-sC",
			"-p", portSpec,
			"--script", "version",
			ip,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			utils.Logger.Warnf("nmap scan failed for %s: %v", ip, err)
			continue
		}

		// Parse nmap output (simplified - in production, use nmap XML parser)
		outputStr := string(output)
		lines := strings.Split(outputStr, "\n")

		for _, line := range lines {
			line = strings.TrimSpace(line)

			// Parse port line: "PORT   STATE SERVICE VERSION"
			if strings.Contains(line, "PORT") && strings.Contains(line, "STATE") {
				continue
			}

			// Parse port/service line: "80/tcp   open  http    Apache httpd 2.4.41"
			parts := strings.Fields(line)
			if len(parts) >= 4 && strings.Contains(parts[0], "/") {
				portService := strings.Split(parts[0], "/")
				if len(portService) == 2 {
					var port int
					fmt.Sscanf(portService[0], "%d", &port)
					if port > 0 {
						service := parts[2]
						version := ""
						if len(parts) > 3 {
							version = strings.Join(parts[3:], " ")
						}

						results = append(results, ServiceResult{
							IP:      ip,
							Port:    port,
							Service: service,
							Version: version,
						})
					}
				}
			}
		}
	}

	utils.Logger.Infof("service detection completed: found %d services", len(results))
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
		filepath.Join("/usr", "sbin", toolName),
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

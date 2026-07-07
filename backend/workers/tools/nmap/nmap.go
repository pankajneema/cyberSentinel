package nmap

import (
	"context"
	"fmt"
	"os/exec"
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

	toolPath, err := utils.LookPath("nmap")
	if err != nil {
		// Fallback to service_detector wrapper
		toolPath, err = utils.LookPath("service_detector")
		if err != nil {
			return nil, fmt.Errorf("nmap/service_detector not found: %v", err)
		}
	}

	var results []ServiceResult

	utils.Logger.Debugf("nmap: scanning %d IPs with %d ports", len(ips), len(ports))

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

		utils.Logger.Debugf("nmap: scanning %s with ports %s", ip, portSpec)

		// Run nmap with service detection
		cmd := exec.CommandContext(ctx, toolPath,
			"-sV",
			"-sC",
			"-p", portSpec,
			"--script", "version",
			ip,
		)

		output, err := cmd.CombinedOutput()
		utils.Logger.Debugf("nmap: raw output for %s (first 500 chars): %s", ip, string(output)[:min(500, len(string(output)))])

		if err != nil {
			utils.Logger.Warnf("nmap scan failed for %s: %v, output length: %d", ip, err, len(output))
			// Continue even if error - might have partial results
		}

		// Parse nmap output (simplified - in production, use nmap XML parser)
		outputStr := string(output)
		lines := strings.Split(outputStr, "\n")
		utils.Logger.Debugf("nmap: parsed %d lines from output for %s", len(lines), ip)

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
						utils.Logger.Debugf("nmap: found service %s on %s:%d", service, ip, port)
					}
				}
			}
		}
	}

	utils.Logger.Infof("service detection completed: found %d services from %d IPs", len(results), len(ips))
	return results, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

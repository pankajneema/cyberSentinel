package naabu

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"workers/utils"
)

// PortResult represents a discovered port
type PortResult struct {
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol,omitempty"`
}

// RunTopPortsScan scans top ports on given IPs
func RunTopPortsScan(ctx context.Context, ips []string) ([]PortResult, error) {
	if len(ips) == 0 {
		return []PortResult{}, nil
	}

	toolPath, err := utils.LookPath("naabu")
	if err != nil {
		// Fallback to top_ports_scanner symlink
		toolPath, err = utils.LookPath("top_ports_scanner")
		if err != nil {
			// Try nmap as fallback for port scanning
			nmapPath, nmapErr := utils.LookPath("nmap")
			if nmapErr == nil {
				utils.Logger.Warnf("naabu not found, using nmap as fallback for port scanning")
				return runNmapPortScan(ctx, nmapPath, ips)
			}
			utils.Logger.Errorf("naabu/top_ports_scanner not found and nmap fallback failed: naabu=%v, nmap=%v", err, nmapErr)
			return nil, fmt.Errorf("naabu/top_ports_scanner not found: %v", err)
		}
	}

	// Combine IPs into comma-separated list
	ipList := strings.Join(ips, ",")

	// Run naabu with top ports
	cmd := exec.CommandContext(ctx, toolPath,
		"-host", ipList,
		"-top-ports", "1000",
		"-json",
		"-silent",
	)

	utils.Logger.Debugf("naabu: scanning %d IPs: %v", len(ips), ips)
	utils.Logger.Debugf("naabu: command: %s -host %s -top-ports 1000 -json -silent", toolPath, ipList)

	output, err := cmd.CombinedOutput()
	utils.Logger.Debugf("naabu: raw output (first 500 chars): %s", string(output)[:min(500, len(string(output)))])

	if err != nil {
		// naabu may return non-zero exit code even with results
		utils.Logger.Warnf("naabu exited with error (may have results): %v, output length: %d", err, len(output))
	}

	var results []PortResult
	lines := strings.Split(string(output), "\n")
	utils.Logger.Debugf("naabu: parsed %d lines from output", len(lines))

	for idx, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var result map[string]interface{}
		if err := json.Unmarshal([]byte(line), &result); err != nil {
			utils.Logger.Debugf("naabu: failed to parse line %d: %s, error: %v", idx, line, err)
			continue
		}

		ip, _ := result["ip"].(string)
		port, ok := result["port"].(float64)
		if !ok {
			utils.Logger.Debugf("naabu: line %d missing port field: %v", idx, result)
			continue
		}

		results = append(results, PortResult{
			IP:       ip,
			Port:     int(port),
			Protocol: "tcp", // naabu defaults to TCP
		})
		utils.Logger.Debugf("naabu: found port %s:%d", ip, int(port))
	}

	utils.Logger.Infof("naabu scan completed: found %d open ports from %d IPs", len(results), len(ips))
	return results, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// runNmapPortScan uses nmap as fallback when naabu is not available
func runNmapPortScan(ctx context.Context, nmapPath string, ips []string) ([]PortResult, error) {
	utils.Logger.Debugf("nmap fallback: scanning %d IPs for ports", len(ips))
	var results []PortResult

	for _, ip := range ips {
		// Run nmap with top ports scan
		cmd := exec.CommandContext(ctx, nmapPath,
			"-sS",
			"--top-ports", "1000",
			"--open",
			"-oG", "-", // Grepable output
			ip,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			utils.Logger.Debugf("nmap fallback: scan failed for %s: %v", ip, err)
			continue
		}

		// Parse nmap grepable output: "Host: 1.2.3.4 () Ports: 80/open/tcp//http//, 443/open/tcp//https//"
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if strings.Contains(line, "Ports:") {
				// Extract ports from line
				parts := strings.Split(line, "Ports:")
				if len(parts) > 1 {
					portsStr := parts[1]
					portParts := strings.Split(portsStr, ",")
					for _, portPart := range portParts {
						portPart = strings.TrimSpace(portPart)
						if strings.Contains(portPart, "/open/") {
							portFields := strings.Split(portPart, "/")
							if len(portFields) > 0 {
								var port int
								if _, err := fmt.Sscanf(portFields[0], "%d", &port); err == nil && port > 0 {
									results = append(results, PortResult{
										IP:       ip,
										Port:     port,
										Protocol: "tcp",
									})
								}
							}
						}
					}
				}
			}
		}
	}

	utils.Logger.Infof("nmap fallback: found %d open ports from %d IPs", len(results), len(ips))
	return results, nil
}

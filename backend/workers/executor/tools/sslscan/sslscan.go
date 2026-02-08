package sslscan

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"workers/utils"
)

// SSLResult represents SSL/TLS metadata
type SSLResult struct {
	Host       string   `json:"host"`
	Port       int      `json:"port"`
	Protocol   string   `json:"protocol,omitempty"`
	Cipher     string   `json:"cipher,omitempty"`
	Certificate string `json:"certificate,omitempty"`
	Issuer     string   `json:"issuer,omitempty"`
	ValidUntil string   `json:"valid_until,omitempty"`
}

// RunSSLAnalysis analyzes SSL/TLS configuration
func RunSSLAnalysis(ctx context.Context, hosts []string) ([]SSLResult, error) {
	if len(hosts) == 0 {
		return []SSLResult{}, nil
	}

	toolPath, err := getToolPath("sslscan")
	if err != nil {
		// Fallback to ssl_analyzer wrapper
		toolPath, err = getToolPath("ssl_analyzer")
		if err != nil {
			utils.Logger.Warnf("sslscan/ssl_analyzer not found: %v - SSL analysis will be skipped", err)
			// Return empty results instead of error to allow pipeline to continue
			// Still create results for reachable hosts to indicate we tried
			var results []SSLResult
			for _, host := range hosts {
				hostPort := host
				port := 443
				if strings.Contains(host, ":") {
					parts := strings.Split(host, ":")
					hostPort = parts[0]
					fmt.Sscanf(parts[1], "%d", &port)
				}
				results = append(results, SSLResult{
					Host: hostPort,
					Port: port,
				})
			}
			return results, nil
		}
	}

	var results []SSLResult

	for _, host := range hosts {
		// Extract host and port
		hostPort := host
		port := 443
		if strings.Contains(host, ":") {
			parts := strings.Split(host, ":")
			hostPort = parts[0]
			fmt.Sscanf(parts[1], "%d", &port)
		}

		// Run sslscan
		utils.Logger.Debugf("sslscan: analyzing %s:%d", hostPort, port)
		cmd := exec.CommandContext(ctx, toolPath, hostPort)
		output, err := cmd.CombinedOutput()
		utils.Logger.Debugf("sslscan: raw output for %s (first 500 chars): %s", hostPort, string(output)[:min(500, len(string(output)))])
		
		if err != nil {
			utils.Logger.Warnf("sslscan failed for %s: %v, output length: %d", host, err, len(output))
			// Continue even if error - might have partial results
		}

		// Parse sslscan output (simplified)
		outputStr := string(output)
		result := SSLResult{
			Host: hostPort,
			Port: port,
		}
		
		// If output is empty, still add result to indicate we tried
		if len(outputStr) == 0 {
			utils.Logger.Debugf("sslscan: empty output for %s, adding empty result", hostPort)
			results = append(results, result)
			continue
		}

		// Extract certificate info
		lines := strings.Split(outputStr, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "Certificate:") {
				result.Certificate = strings.TrimPrefix(line, "Certificate:")
			} else if strings.Contains(line, "Issuer:") {
				result.Issuer = strings.TrimPrefix(line, "Issuer:")
			} else if strings.Contains(line, "Not valid after:") {
				result.ValidUntil = strings.TrimPrefix(line, "Not valid after:")
			} else if strings.Contains(line, "Cipher:") {
				result.Cipher = strings.TrimPrefix(line, "Cipher:")
			}
		}

		results = append(results, result)
	}

	utils.Logger.Infof("SSL analysis completed: analyzed %d hosts", len(results))
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}


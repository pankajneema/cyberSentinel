package naabu

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

// PortResult represents a discovered port
type PortResult struct {
	IP   string `json:"ip"`
	Port int    `json:"port"`
	Protocol string `json:"protocol,omitempty"`
}

// RunTopPortsScan scans top ports on given IPs
func RunTopPortsScan(ctx context.Context, ips []string) ([]PortResult, error) {
	if len(ips) == 0 {
		return []PortResult{}, nil
	}

	toolPath, err := getToolPath("naabu")
	if err != nil {
		// Fallback to top_ports_scanner symlink
		toolPath, err = getToolPath("top_ports_scanner")
		if err != nil {
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

	output, err := cmd.CombinedOutput()
	if err != nil {
		// naabu may return non-zero exit code even with results
		utils.Logger.Warnf("naabu exited with error (may have results): %v", err)
	}

	var results []PortResult
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

		ip, _ := result["ip"].(string)
		port, ok := result["port"].(float64)
		if !ok {
			continue
		}

		results = append(results, PortResult{
			IP:       ip,
			Port:     int(port),
			Protocol: "tcp", // naabu defaults to TCP
		})
	}

	utils.Logger.Infof("naabu scan completed: found %d open ports", len(results))
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


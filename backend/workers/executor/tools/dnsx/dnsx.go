package dnsx

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"workers/utils"
)

// getToolPath finds the tool executable in PATH or common locations
// Returns the full path to the tool or an error if not found
func getToolPath(toolName string) (string, error) {
	// First try PATH
	if path, err := exec.LookPath(toolName); err == nil {
		utils.Logger.Debugf("found %s in PATH: %s", toolName, path)
		return path, nil
	}

	// Try Go bin directory from GOPATH env
	if goPath := os.Getenv("GOPATH"); goPath != "" {
		toolPath := filepath.Join(goPath, "bin", toolName)
		if _, err := os.Stat(toolPath); err == nil {
			utils.Logger.Debugf("found %s in GOPATH/bin: %s", toolName, toolPath)
			return toolPath, nil
		}
	}

	// Try common Go bin locations
	homeDir, _ := os.UserHomeDir()
	commonPaths := []string{
		filepath.Join(homeDir, "go", "bin", toolName),
		filepath.Join("/home", "anonymous", "go", "bin", toolName), // Explicit fallback
		filepath.Join("/usr", "local", "bin", toolName),
		filepath.Join("/usr", "bin", toolName),
		filepath.Join("/opt", "bin", toolName),
	}

	for _, path := range commonPaths {
		if info, err := os.Stat(path); err == nil {
			// Check if it's executable
			if info.Mode().Perm()&0111 != 0 {
				utils.Logger.Debugf("found %s at: %s", toolName, path)
				return path, nil
			}
		}
	}

	// Last resort: try to find in current user's go bin
	if homeDir != "" {
		userGoBin := filepath.Join(homeDir, "go", "bin", toolName)
		if _, err := os.Stat(userGoBin); err == nil {
			utils.Logger.Debugf("found %s in user go bin: %s", toolName, userGoBin)
			return userGoBin, nil
		}
	}

	// Tool not found
	return "", fmt.Errorf("tool '%s' not found in PATH or common locations (checked GOPATH/bin, ~/go/bin, /usr/local/bin, /usr/bin)", toolName)
}

// DNSResult represents DNS resolution result
type DNSResult struct {
	Subdomain string   `json:"subdomain"`
	IPs       []string `json:"ips"`
}

// RunDNSResolution resolves DNS for given subdomains
// Returns map with subdomain -> IPs mapping
func RunDNSResolution(ctx context.Context, subdomains []string) (map[string][]string, error) {
	if len(subdomains) == 0 {
		return make(map[string][]string), nil
	}

	utils.Logger.Infof("running dnsx resolution for %d subdomains", len(subdomains))

	// Create input file content
	input := strings.Join(subdomains, "\n")

	dnsxPath, err := getToolPath("dnsx")
	if err != nil {
		return nil, fmt.Errorf("failed to find dnsx tool: %w", err)
	}

	cmd := exec.CommandContext(
		ctx,
		dnsxPath,
		"-l", "-", // Read from stdin
		"-a",      // A record
		"-resp",   // Include response
		"-json",   // JSON output
	)

	cmd.Stdin = strings.NewReader(input)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start dnsx: %w", err)
	}

	results := make(map[string][]string)
	scanner := bufio.NewScanner(stdout)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var dnsData map[string]interface{}
		if err := json.Unmarshal([]byte(line), &dnsData); err != nil {
			utils.Logger.Warnf("failed to parse dnsx JSON line: %s", line)
			continue
		}

		host, ok := dnsData["host"].(string)
		if !ok {
			continue
		}

		// Extract IP addresses
		var ips []string
		if answer, ok := dnsData["a"].([]interface{}); ok {
			for _, ip := range answer {
				if ipStr, ok := ip.(string); ok {
					ips = append(ips, ipStr)
				}
			}
		} else if answer, ok := dnsData["a"].(string); ok {
			ips = []string{answer}
		}

		if len(ips) > 0 {
			results[host] = ips
		}
	}

	if err := cmd.Wait(); err != nil {
		// DNS resolution failures are expected for some subdomains
		utils.Logger.Warnf("dnsx completed with some failures: %v", err)
	}

	utils.Logger.Infof("dnsx resolved %d/%d subdomains", len(results), len(subdomains))
	return results, nil
}

// RunIPMapping maps domain to IPs (similar to DNS resolution but for domain)
func RunIPMapping(ctx context.Context, domain string) ([]string, error) {
	utils.Logger.Infof("running dnsx IP mapping for %s", domain)

	dnsxPath, err := getToolPath("dnsx")
	if err != nil {
		return nil, fmt.Errorf("failed to find dnsx tool: %w", err)
	}

	cmd := exec.CommandContext(
		ctx,
		dnsxPath,
		"-d", domain,
		"-a",    // A record
		"-resp", // Include response
		"-json", // JSON output
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start dnsx: %w", err)
	}

	var ips []string
	scanner := bufio.NewScanner(stdout)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var dnsData map[string]interface{}
		if err := json.Unmarshal([]byte(line), &dnsData); err != nil {
			continue
		}

		if answer, ok := dnsData["a"].([]interface{}); ok {
			for _, ip := range answer {
				if ipStr, ok := ip.(string); ok {
					ips = append(ips, ipStr)
				}
			}
		} else if answer, ok := dnsData["a"].(string); ok {
			ips = append(ips, answer)
		}
	}

	if err := cmd.Wait(); err != nil {
		utils.Logger.Warnf("dnsx IP mapping completed with warnings: %v", err)
	}

	utils.Logger.Infof("dnsx found %d IPs for %s", len(ips), domain)
	return ips, nil
}


package dnsx

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"workers/utils"
)

// Returns the full path to the tool or an error if not found

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

	dnsxPath, err := utils.LookPath("dnsx")
	if err != nil {
		return nil, fmt.Errorf("failed to find dnsx tool: %w", err)
	}

	cmd := exec.CommandContext(
		ctx,
		dnsxPath,
		"-l", "-", // Read from stdin
		"-a",    // A record
		"-resp", // Include response
		"-json", // JSON output
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

	dnsxPath, err := utils.LookPath("dnsx")
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

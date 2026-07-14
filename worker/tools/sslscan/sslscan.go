package sslscan

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"worker/utils"
)

// SSLResult represents SSL/TLS metadata
type SSLResult struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Protocol    string `json:"protocol,omitempty"`
	Cipher      string `json:"cipher,omitempty"`
	Certificate string `json:"certificate,omitempty"`
	Issuer      string `json:"issuer,omitempty"`
	ValidUntil  string `json:"valid_until,omitempty"`
}

// RunSSLAnalysis analyzes SSL/TLS configuration
func RunSSLAnalysis(ctx context.Context, hosts []string) ([]SSLResult, error) {
	if len(hosts) == 0 {
		return []SSLResult{}, nil
	}

	toolPath, err := utils.LookPath("sslscan")
	if err != nil {
		// Fallback to ssl_analyzer wrapper
		toolPath, err = utils.LookPath("ssl_analyzer")
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

	// Bound the work: previously hosts were scanned sequentially with the shared
	// job context and no per-host timeout, so 25 hosts × a slow/hanging sslscan
	// could burn ~500s and blow the whole job deadline. Now each host gets its
	// own timeout and we run a bounded number concurrently.
	const (
		perHostTimeout = 20 * time.Second
		maxConcurrent  = 8
	)

	results := make([]SSLResult, len(hosts)) // index-aligned; no shared-append race
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup

	for idx, host := range hosts {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, host string) {
			defer wg.Done()
			defer func() { <-sem }()

			hostPort := host
			port := 443
			if strings.Contains(host, ":") {
				parts := strings.Split(host, ":")
				hostPort = parts[0]
				fmt.Sscanf(parts[1], "%d", &port)
			}

			result := SSLResult{Host: hostPort, Port: port}

			// Per-host deadline derived from the job ctx (cancels with the job,
			// but caps a single host at perHostTimeout).
			hostCtx, cancel := context.WithTimeout(ctx, perHostTimeout)
			defer cancel()

			cmd := exec.CommandContext(hostCtx, toolPath, hostPort)
			output, err := cmd.CombinedOutput()
			if err != nil {
				utils.Logger.Warnf("sslscan failed for %s: %v, output length: %d", host, err, len(output))
			}

			for _, line := range strings.Split(string(output), "\n") {
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
			results[idx] = result
		}(idx, host)
	}
	wg.Wait()

	utils.Logger.Infof("SSL analysis completed: analyzed %d hosts (concurrent, per-host %s)", len(results), perHostTimeout)
	return results, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

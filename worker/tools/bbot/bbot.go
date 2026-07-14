package bbot

import (
	"bufio"
	"context"
	"os/exec"
	"regexp"
	"strings"
	"worker/utils"
)

// RunRecursiveDiscovery executes bbot and extracts discovered subdomains from stdout.
func RunRecursiveDiscovery(ctx context.Context, domain string) ([]string, error) {
	toolPath, err := utils.LookPath("bbot")
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, toolPath, "-t", domain, "-f", "subdomain-enum")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	re := regexp.MustCompile(`([a-zA-Z0-9_-]+\.)+` + regexp.QuoteMeta(domain))
	seen := make(map[string]bool)
	var out []string
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		matches := re.FindAllString(strings.ToLower(scanner.Text()), -1)
		for _, match := range matches {
			match = strings.TrimSpace(strings.Trim(match, ".,"))
			if match != "" && !seen[match] {
				seen[match] = true
				out = append(out, match)
			}
		}
	}

	if err := cmd.Wait(); err != nil && len(out) == 0 {
		return nil, err
	}
	return out, nil
}

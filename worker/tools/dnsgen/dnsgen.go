package dnsgen

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"strings"
	"worker/utils"
)

// RunExpansion generates additional candidate subdomains from seed subdomains.
func RunExpansion(ctx context.Context, seeds []string) ([]string, error) {
	if len(seeds) == 0 {
		return nil, nil
	}

	toolPath, err := utils.LookPath("dnsgen")
	if err != nil {
		return nil, err
	}

	tmpFile, err := os.CreateTemp("", "dnsgen-seeds-*.txt")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	if _, err := tmpFile.WriteString(strings.Join(seeds, "\n")); err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, toolPath, tmpFile.Name())
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var out []string
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		candidate := strings.ToLower(strings.TrimSpace(scanner.Text()))
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		out = append(out, candidate)
	}

	if err := cmd.Wait(); err != nil && len(out) == 0 {
		return nil, err
	}
	return out, nil
}

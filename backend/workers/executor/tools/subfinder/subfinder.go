package subfinder

import (
	"bufio"
	"context"
	"os/exec"

	"workers/utils"
)

// Run executes subfinder for given domain
func Run(ctx context.Context, domain string) ([]string, error) {
	utils.Logger.Infof("running subfinder for %s", domain)

	cmd := exec.CommandContext(
		ctx,
		"subfinder",
		"-silent",
		"-d", domain,
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	var results []string
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		results = append(results, scanner.Text())
	}

	if err := cmd.Wait(); err != nil {
		return nil, err
	}

	utils.Logger.Infof("subfinder found %d subdomains", len(results))
	return results, nil
}

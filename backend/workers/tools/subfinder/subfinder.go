package subfinder

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"

	"workers/utils"
)

// Run executes subfinder for given domain
func Run(ctx context.Context, domain string) ([]string, error) {
	utils.Logger.Infof("running subfinder for %s", domain)

	subfinderPath, err := utils.LookPath("subfinder")
	if err != nil {
		return nil, fmt.Errorf("failed to find subfinder tool: %w", err)
	}

	cmd := exec.CommandContext(
		ctx,
		subfinderPath,
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

package subfinder

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"workers/utils"
)

// getToolPath finds the tool executable in PATH or common locations
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

// Run executes subfinder for given domain
func Run(ctx context.Context, domain string) ([]string, error) {
	utils.Logger.Infof("running subfinder for %s", domain)

	subfinderPath, err := getToolPath("subfinder")
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

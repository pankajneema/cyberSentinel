package amass

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func getToolPath(toolName string) (string, error) {
	if path, err := exec.LookPath(toolName); err == nil {
		return path, nil
	}

	if goPath := os.Getenv("GOPATH"); goPath != "" {
		toolPath := filepath.Join(goPath, "bin", toolName)
		if _, err := os.Stat(toolPath); err == nil {
			return toolPath, nil
		}
	}

	homeDir, _ := os.UserHomeDir()
	commonPaths := []string{
		filepath.Join(homeDir, "go", "bin", toolName),
		filepath.Join("/usr", "local", "bin", toolName),
		filepath.Join("/usr", "bin", toolName),
	}
	for _, path := range commonPaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("tool %q not found", toolName)
}

// RunDeepDiscovery executes amass passive enumeration and returns unique subdomains.
func RunDeepDiscovery(ctx context.Context, domain string) ([]string, error) {
	toolPath, err := getToolPath("amass")
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, toolPath, "enum", "-passive", "-norecursive", "-noalts", "-d", domain, "-json", "-")
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
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var record map[string]interface{}
		if err := json.Unmarshal([]byte(line), &record); err == nil {
			if name, ok := record["name"].(string); ok && name != "" && !seen[name] {
				seen[name] = true
				out = append(out, strings.ToLower(name))
			}
			continue
		}

		if strings.HasSuffix(strings.ToLower(line), strings.ToLower(domain)) && !seen[line] {
			seen[line] = true
			out = append(out, strings.ToLower(line))
		}
	}

	if err := cmd.Wait(); err != nil && len(out) == 0 {
		return nil, err
	}
	return out, nil
}

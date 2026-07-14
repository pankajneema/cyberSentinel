package amass

import (
	"bufio"
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"worker/utils"
)

// RunDeepDiscovery executes amass passive enumeration and returns unique subdomains.
func RunDeepDiscovery(ctx context.Context, domain string) ([]string, error) {
	toolPath, err := utils.LookPath("amass")
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

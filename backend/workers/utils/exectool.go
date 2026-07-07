package utils

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// LookPath resolves an external tool binary. It prefers explicit install
// locations (Homebrew, Go bin, common system dirs, Python user bases) BEFORE
// falling back to $PATH, so a colliding same-named script on PATH (e.g. the
// Python `httpx` package) does not shadow the intended ProjectDiscovery
// binary. This is the single shared resolver — tool wrappers must not
// re-implement their own getToolPath.
func LookPath(toolName string) (string, error) {
	homeDir, _ := os.UserHomeDir()

	commonPaths := []string{
		filepath.Join("/opt", "homebrew", "bin", toolName),
		filepath.Join(homeDir, "go", "bin", toolName),
		filepath.Join(homeDir, ".local", "bin", toolName),
		filepath.Join(homeDir, ".local", "pipx", "venvs", toolName, "bin", toolName),
		filepath.Join("/home", "anonymous", "go", "bin", toolName),
		filepath.Join("/usr", "local", "bin", toolName),
		filepath.Join("/usr", "bin", toolName),
		filepath.Join("/usr", "sbin", toolName),
	}

	if pyUserBase := os.Getenv("PYTHONUSERBASE"); pyUserBase != "" {
		commonPaths = append(commonPaths, filepath.Join(pyUserBase, "bin", toolName))
	}
	if homeDir != "" {
		if matches, err := filepath.Glob(filepath.Join(homeDir, "Library", "Python", "*", "bin", toolName)); err == nil {
			commonPaths = append(commonPaths, matches...)
		}
	}

	for _, path := range commonPaths {
		if info, err := os.Stat(path); err == nil && info.Mode().Perm()&0111 != 0 {
			return path, nil
		}
	}

	// GOPATH/bin, then finally $PATH.
	if goPath := os.Getenv("GOPATH"); goPath != "" {
		toolPath := filepath.Join(goPath, "bin", toolName)
		if _, err := os.Stat(toolPath); err == nil {
			return toolPath, nil
		}
	}
	if path, err := exec.LookPath(toolName); err == nil {
		return path, nil
	}

	return "", fmt.Errorf("tool %q not found in PATH or common locations", toolName)
}

// RunCommand resolves the tool, runs it with args, and returns combined
// stdout+stderr. It is a convenience for tools that consume a full-output blob;
// streaming tools should resolve via LookPath and drive exec themselves.
func RunCommand(ctx context.Context, toolName string, args ...string) ([]byte, error) {
	path, err := LookPath(toolName)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	runErr := cmd.Run()
	return buf.Bytes(), runErr
}

// VerifyTools checks that required ASM tools are available. Tools are grouped by
// intensity level: LIGHT (required), MEDIUM (NORMAL), HIGH (DEEP).
func VerifyTools() error {
	lightTools := []string{"subfinder", "dnsx", "httpx", "httprobe"}
	mediumTools := []string{"amass", "asnmap", "top_ports_scanner", "service_detector", "ssl_analyzer", "api_detector"}
	deepTools := []string{"bbot", "dnsgen", "nuclei", "cloud_osint", "admin_finder", "backup_detector", "asset_diff_engine"}

	missing := []string{}
	warnings := []string{}

	Logger.Info("=== Verifying LIGHT intensity tools ===")
	for _, tool := range lightTools {
		path, err := LookPath(tool)
		if err != nil {
			missing = append(missing, tool)
			Logger.Warnf("✗ tool '%s' not found: %v", tool, err)
		} else {
			Logger.Infof("✓ tool '%s' found at: %s", tool, path)
		}
	}

	Logger.Info("=== Verifying MEDIUM (NORMAL) intensity tools ===")
	for _, tool := range mediumTools {
		path, err := LookPath(tool)
		if err != nil {
			warnings = append(warnings, tool)
			Logger.Warnf("⚠ tool '%s' not found (optional for MEDIUM intensity): %v", tool, err)
		} else {
			Logger.Infof("✓ tool '%s' found at: %s", tool, path)
		}
	}

	Logger.Info("=== Verifying HIGH (DEEP) intensity tools ===")
	for _, tool := range deepTools {
		path, err := LookPath(tool)
		if err != nil {
			warnings = append(warnings, tool)
			Logger.Warnf("⚠ tool '%s' not found (optional for HIGH intensity): %v", tool, err)
		} else {
			Logger.Infof("✓ tool '%s' found at: %s", tool, path)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required LIGHT intensity tools: %v. Please install them or add to PATH", missing)
	}
	if len(warnings) > 0 {
		Logger.Warnf("some optional tools are missing: %v. MEDIUM/HIGH intensity pipelines may not work fully", warnings)
	}

	Logger.Info("✓ all required ASM tools verified and available")
	return nil
}

// SetupPath prepends Go/Python user bin directories to $PATH when they exist, so
// LookPath and child processes can find go-installed and pip-installed tools.
func SetupPath() {
	goPath := os.Getenv("GOPATH")
	homeDir, _ := os.UserHomeDir()

	pathsToAdd := []string{}

	if goPath != "" {
		goBin := filepath.Join(goPath, "bin")
		if _, err := os.Stat(goBin); err == nil {
			pathsToAdd = append(pathsToAdd, goBin)
		}
	}

	if homeDir != "" {
		userGoBin := filepath.Join(homeDir, "go", "bin")
		if _, err := os.Stat(userGoBin); err == nil {
			pathsToAdd = append(pathsToAdd, userGoBin)
		}
		userLocalBin := filepath.Join(homeDir, ".local", "bin")
		if _, err := os.Stat(userLocalBin); err == nil {
			pathsToAdd = append(pathsToAdd, userLocalBin)
		}
		if matches, err := filepath.Glob(filepath.Join(homeDir, "Library", "Python", "*", "bin")); err == nil {
			pathsToAdd = append(pathsToAdd, matches...)
		}
	}

	explicitGoBin := "/home/anonymous/go/bin"
	if _, err := os.Stat(explicitGoBin); err == nil {
		pathsToAdd = append(pathsToAdd, explicitGoBin)
	}

	if pyUserBase := os.Getenv("PYTHONUSERBASE"); pyUserBase != "" {
		pyUserBin := filepath.Join(pyUserBase, "bin")
		if _, err := os.Stat(pyUserBin); err == nil {
			pathsToAdd = append(pathsToAdd, pyUserBin)
		}
	}

	if _, err := os.Stat("/opt/homebrew/bin"); err == nil {
		pathsToAdd = append(pathsToAdd, "/opt/homebrew/bin")
	}

	currentPath := os.Getenv("PATH")
	for _, path := range pathsToAdd {
		if path == "" || strings.Contains(currentPath, path) {
			continue
		}
		if currentPath == "" {
			currentPath = path
		} else {
			currentPath = path + ":" + currentPath
		}
	}

	if len(pathsToAdd) > 0 {
		os.Setenv("PATH", currentPath)
		Logger.Infof("updated PATH to include: %v", pathsToAdd)
	}
}

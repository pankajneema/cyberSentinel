package tools

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"workers/utils"
)

// VerifyTools checks if all required ASM tools are available
// Tools are grouped by intensity level: LIGHT, MEDIUM (NORMAL), HIGH (DEEP)
func VerifyTools() error {
	// LIGHT intensity tools (required)
	lightTools := []string{"subfinder", "dnsx", "httpx", "httprobe"}
	
	// MEDIUM (NORMAL) intensity tools (optional but recommended)
	mediumTools := []string{"top_ports_scanner", "service_detector", "ssl_analyzer", "api_detector"}
	
	// HIGH (DEEP) intensity tools (optional)
	deepTools := []string{"cloud_osint", "admin_finder", "backup_detector", "asset_diff_engine"}
	
	missing := []string{}
	warnings := []string{}

	// Check LIGHT tools (required)
	utils.Logger.Info("=== Verifying LIGHT intensity tools ===")
	for _, tool := range lightTools {
		path, err := findToolPath(tool)
		if err != nil {
			missing = append(missing, tool)
			utils.Logger.Warnf("✗ tool '%s' not found: %v", tool, err)
		} else {
			utils.Logger.Infof("✓ tool '%s' found at: %s", tool, path)
		}
	}

	// Check MEDIUM tools (optional)
	utils.Logger.Info("=== Verifying MEDIUM (NORMAL) intensity tools ===")
	for _, tool := range mediumTools {
		path, err := findToolPath(tool)
		if err != nil {
			warnings = append(warnings, tool)
			utils.Logger.Warnf("⚠ tool '%s' not found (optional for MEDIUM intensity): %v", tool, err)
		} else {
			utils.Logger.Infof("✓ tool '%s' found at: %s", tool, path)
		}
	}

	// Check HIGH tools (optional)
	utils.Logger.Info("=== Verifying HIGH (DEEP) intensity tools ===")
	for _, tool := range deepTools {
		path, err := findToolPath(tool)
		if err != nil {
			warnings = append(warnings, tool)
			utils.Logger.Warnf("⚠ tool '%s' not found (optional for HIGH intensity): %v", tool, err)
		} else {
			utils.Logger.Infof("✓ tool '%s' found at: %s", tool, path)
		}
	}

	// Fail only if LIGHT tools are missing
	if len(missing) > 0 {
		return fmt.Errorf("missing required LIGHT intensity tools: %v. Please install them or add to PATH", missing)
	}

	if len(warnings) > 0 {
		utils.Logger.Warnf("some optional tools are missing: %v. MEDIUM/HIGH intensity pipelines may not work fully", warnings)
	}

	utils.Logger.Info("✓ all required ASM tools verified and available")
	return nil
}

// findToolPath finds the tool executable in PATH or common locations
func findToolPath(toolName string) (string, error) {
	// First try PATH
	if path, err := exec.LookPath(toolName); err == nil {
		return path, nil
	}

	// Try Go bin directory from GOPATH env
	if goPath := os.Getenv("GOPATH"); goPath != "" {
		toolPath := filepath.Join(goPath, "bin", toolName)
		if _, err := os.Stat(toolPath); err == nil {
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
				return path, nil
			}
		}
	}

	return "", fmt.Errorf("tool '%s' not found", toolName)
}

// SetupPath adds Go bin directories to PATH if tools are found there
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
	}
	
	// Also check explicit path
	explicitGoBin := "/home/anonymous/go/bin"
	if _, err := os.Stat(explicitGoBin); err == nil {
		pathsToAdd = append(pathsToAdd, explicitGoBin)
	}
	
	currentPath := os.Getenv("PATH")
	for _, path := range pathsToAdd {
		if currentPath == "" {
			currentPath = path
		} else {
			currentPath = path + ":" + currentPath
		}
	}
	
	if len(pathsToAdd) > 0 {
		os.Setenv("PATH", currentPath)
		utils.Logger.Infof("updated PATH to include: %v", pathsToAdd)
	}
}


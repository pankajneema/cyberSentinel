# ASM Security Tools Installation Guide

## Required Tools

The ASM pipeline requires the following security tools to be installed:

1. **subfinder** - Subdomain discovery
2. **dnsx** - DNS resolution and IP mapping
3. **httpx** - HTTP status checking
4. **httprobe** - HTTP/HTTPS reachability checking

## Quick Installation

### Option 1: Using Installation Script (Recommended)

```bash
cd backend/workers
./install-tools.sh
```

### Option 2: Manual Installation

#### Install Go (if not installed)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y golang-go

# macOS
brew install go

# Verify installation
go version
```

#### Install Tools via Go

```bash
# Install subfinder
go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest

# Install dnsx
go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest

# Install httpx
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest

# Install httprobe
go install github.com/tomnomnom/httprobe@latest
```

#### Add Go bin to PATH

```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH=$PATH:$(go env GOPATH)/bin

# Reload shell
source ~/.bashrc  # or source ~/.zshrc
```

### Option 3: Download Pre-built Binaries

#### Linux (amd64)

```bash
# subfinder
wget https://github.com/projectdiscovery/subfinder/releases/latest/download/subfinder-linux-amd64.tar.gz
tar -xzf subfinder-linux-amd64.tar.gz
sudo mv subfinder /usr/local/bin/

# dnsx
wget https://github.com/projectdiscovery/dnsx/releases/latest/download/dnsx-linux-amd64.zip
unzip dnsx-linux-amd64.zip
sudo mv dnsx /usr/local/bin/

# httpx
wget https://github.com/projectdiscovery/httpx/releases/latest/download/httpx-linux-amd64.zip
unzip httpx-linux-amd64.zip
sudo mv httpx /usr/local/bin/

# httprobe
wget https://github.com/tomnomnom/httprobe/releases/latest/download/httprobe-linux-amd64
sudo mv httprobe-linux-amd64 /usr/local/bin/httprobe
sudo chmod +x /usr/local/bin/httprobe
```

## Verify Installation

```bash
# Check if tools are in PATH
which subfinder
which dnsx
which httpx
which httprobe

# Test tools
subfinder -version
dnsx -version
httpx -version
httprobe -h
```

## Docker Installation

If running in Docker, tools are automatically installed via the Dockerfile:

```bash
cd backend/workers
docker build -t cybersentinel-workers .
```

## Troubleshooting

### Tool not found in PATH

1. Check if tool is installed:
   ```bash
   ls -la $(go env GOPATH)/bin/
   ```

2. Add Go bin to PATH:
   ```bash
   export PATH=$PATH:$(go env GOPATH)/bin
   ```

3. Verify PATH:
   ```bash
   echo $PATH
   ```

### Permission Denied

```bash
# Make tools executable
chmod +x /usr/local/bin/subfinder
chmod +x /usr/local/bin/dnsx
chmod +x /usr/local/bin/httpx
chmod +x /usr/local/bin/httprobe
```

### Go Installation Issues

If Go is not installed, install it first:

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y golang-go

# macOS
brew install go

# Verify
go version
```

## Tool Versions

Recommended versions:
- subfinder: v2.x or latest
- dnsx: v1.x or latest
- httpx: v1.x or latest
- httprobe: latest

## Notes

- All tools must be in system PATH
- Tools are executed as external commands
- Ensure tools have execute permissions
- For production, consider using Docker image with pre-installed tools


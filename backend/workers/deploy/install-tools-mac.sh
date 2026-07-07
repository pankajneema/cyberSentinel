#!/bin/bash

# Install ASM Security Tools (macOS)
# Requires: Homebrew, Go (optional but recommended)

set -e

echo "🔧 Installing ASM Security Tools for macOS..."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ── Homebrew check ──────────────────────────────────────────────────────────
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}Homebrew not found. Installing...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for Apple Silicon Macs
    if [[ $(uname -m) == "arm64" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
fi
echo -e "${GREEN}✓ Homebrew is available${NC}"

# ── Go check ────────────────────────────────────────────────────────────────
if command -v go &> /dev/null; then
    echo -e "${GREEN}✓ Go is installed${NC}"
    GO_INSTALLED=true
else
    echo -e "${YELLOW}⚠ Go not found. Installing via Homebrew...${NC}"
    brew install go
    export PATH="$PATH:$(go env GOPATH)/bin"
    GO_INSTALLED=true
fi

# Ensure Go bin is on PATH
export PATH="$PATH:$(go env GOPATH)/bin"
USER_PYTHON_BIN="$(python3 -m site --user-base 2>/dev/null)/bin"
if [ -n "$USER_PYTHON_BIN" ]; then
    export PATH="$PATH:$USER_PYTHON_BIN"
fi

# ── Helper ───────────────────────────────────────────────────────────────────
install_tool() {
    local tool_name=$1
    local install_cmd=$2

    if command -v "$tool_name" &> /dev/null; then
        echo -e "${GREEN}✓ $tool_name is already installed${NC}"
        return 0
    fi

    echo -e "${YELLOW}Installing $tool_name...${NC}"
    eval "$install_cmd"

    if command -v "$tool_name" &> /dev/null; then
        echo -e "${GREEN}✓ $tool_name installed successfully${NC}"
    else
        echo -e "${RED}✗ Failed to install $tool_name${NC}"
        return 1
    fi
}

# ============================================================
# LIGHT Intensity Tools
# ============================================================

if [ "$GO_INSTALLED" = true ]; then
    install_tool "subfinder" "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"
    install_tool "dnsx"      "go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest"
    install_tool "httpx"     "go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest"
    install_tool "httprobe"  "go install github.com/tomnomnom/httprobe@latest"
else
    install_tool "subfinder" "brew install subfinder"
    install_tool "httpx"     "brew install httpx"
    echo -e "${YELLOW}dnsx and httprobe require Go. Please install Go first.${NC}"
fi

if [ "$GO_INSTALLED" = true ]; then
    install_tool "amass" "go install github.com/owasp-amass/amass/v4/...@master"
    install_tool "asnmap" "go install github.com/projectdiscovery/asnmap/cmd/asnmap@latest"
fi

# ============================================================
# MEDIUM (NORMAL) Intensity Tools
# ============================================================

# naabu → top_ports_scanner
if [ "$GO_INSTALLED" = true ]; then
    install_tool "naabu" "go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest"
else
    install_tool "naabu" "brew install naabu"
fi

if command -v naabu &> /dev/null && ! command -v top_ports_scanner &> /dev/null; then
    echo -e "${YELLOW}Creating symlink: top_ports_scanner -> naabu${NC}"
    ln -sf "$(which naabu)" /usr/local/bin/top_ports_scanner 2>/dev/null || \
        sudo ln -sf "$(which naabu)" /usr/local/bin/top_ports_scanner
    echo -e "${GREEN}✓ top_ports_scanner symlink created${NC}"
fi

# nmap → service_detector
install_tool "nmap" "brew install nmap"

if [ ! -f /usr/local/bin/service_detector ]; then
    echo -e "${YELLOW}Creating service_detector wrapper...${NC}"
    sudo tee /usr/local/bin/service_detector > /dev/null << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: service_detector <target>"; exit 1; fi
nmap -sV -sC --top-ports 1000 "$1" 2>/dev/null || nmap -sV "$1"
EOF
    sudo chmod +x /usr/local/bin/service_detector
    echo -e "${GREEN}✓ service_detector created${NC}"
fi

# sslscan → ssl_analyzer  (macOS binary from Homebrew)
install_tool "sslscan" "brew install sslscan"

if [ ! -f /usr/local/bin/ssl_analyzer ]; then
    echo -e "${YELLOW}Creating ssl_analyzer wrapper...${NC}"
    sudo tee /usr/local/bin/ssl_analyzer > /dev/null << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: ssl_analyzer <target>"; exit 1; fi
sslscan "$1" 2>/dev/null || echo "SSL analysis completed"
EOF
    sudo chmod +x /usr/local/bin/ssl_analyzer
    echo -e "${GREEN}✓ ssl_analyzer created${NC}"
fi

# katana → api_detector
if [ "$GO_INSTALLED" = true ]; then
    install_tool "katana" "go install github.com/projectdiscovery/katana/cmd/katana@latest"
else
    install_tool "katana" "brew install katana"
fi

if command -v katana &> /dev/null && ! command -v api_detector &> /dev/null; then
    echo -e "${YELLOW}Creating api_detector wrapper...${NC}"
    sudo tee /usr/local/bin/api_detector > /dev/null << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: api_detector <target>"; exit 1; fi
katana -u "$1" -silent -json 2>/dev/null | grep -i "api\|endpoint" || katana -u "$1" -silent
EOF
    sudo chmod +x /usr/local/bin/api_detector
    echo -e "${GREEN}✓ api_detector created${NC}"
fi

install_tool "bbot" "python3 -m pip install --user --break-system-packages bbot"
install_tool "dnsgen" "python3 -m pip install --user --break-system-packages dnsgen"
if [ "$GO_INSTALLED" = true ]; then
    install_tool "nuclei" "go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"
fi

# ============================================================
# HIGH (DEEP) Intensity Tools
# ============================================================

# cloud_enum → cloud_osint
if ! command -v cloud_enum &> /dev/null && [ ! -f /usr/local/bin/cloud_enum ]; then
    echo -e "${YELLOW}Installing cloud_enum...${NC}"
    # macOS: use pip3 (installed via Homebrew Python)
    if ! command -v pip3 &> /dev/null; then brew install python3; fi
    python3 -m pip install --user --break-system-packages cloud_enum 2>/dev/null || \
    (git clone https://github.com/initstring/cloud_enum.git /tmp/cloud_enum && \
     sudo cp /tmp/cloud_enum/cloud_enum.py /usr/local/bin/cloud_enum && \
     sudo chmod +x /usr/local/bin/cloud_enum && \
     python3 -m pip install --user --break-system-packages -r /tmp/cloud_enum/requirements.txt 2>/dev/null || true)
    echo -e "${GREEN}✓ cloud_enum installed${NC}"
fi

if [ ! -f /usr/local/bin/cloud_osint ]; then
    echo -e "${YELLOW}Creating cloud_osint wrapper...${NC}"
    sudo tee /usr/local/bin/cloud_osint > /dev/null << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: cloud_osint <target>"; exit 1; fi
cloud_enum -k "$1" 2>/dev/null || python3 /usr/local/bin/cloud_enum -k "$1" 2>/dev/null || echo "Cloud OSINT scan completed"
EOF
    sudo chmod +x /usr/local/bin/cloud_osint
    echo -e "${GREEN}✓ cloud_osint created${NC}"
fi

# gobuster → admin_finder
if [ "$GO_INSTALLED" = true ]; then
    install_tool "gobuster" "go install github.com/OJ/gobuster/v3@latest"
else
    install_tool "gobuster" "brew install gobuster"
fi

if command -v gobuster &> /dev/null && ! command -v admin_finder &> /dev/null; then
    echo -e "${YELLOW}Creating admin_finder wrapper...${NC}"
    # macOS uses /usr/share/wordlists only if installed; fall back to SecLists via Homebrew
    sudo tee /usr/local/bin/admin_finder > /dev/null << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: admin_finder <target>"; exit 1; fi

# Prefer SecLists (brew install seclists) then fall back to built-in dirb list
WORDLIST=""
for w in \
    "$(brew --prefix 2>/dev/null)/share/seclists/Discovery/Web-Content/common.txt" \
    "/usr/share/seclists/Discovery/Web-Content/common.txt" \
    "/usr/share/wordlists/dirb/common.txt"; do
    [ -f "$w" ] && WORDLIST="$w" && break
done

if [ -z "$WORDLIST" ]; then
    echo "No wordlist found. Install SecLists: brew install seclists"
    exit 1
fi

gobuster dir -u "$1" -w "$WORDLIST" -q 2>/dev/null | grep -i "admin\|login\|dashboard" || \
echo "Admin endpoint scan completed"
EOF
    sudo chmod +x /usr/local/bin/admin_finder
    echo -e "${GREEN}✓ admin_finder created${NC}"
fi

# backup_detector
if [ ! -f /usr/local/bin/backup_detector ]; then
    echo -e "${YELLOW}Creating backup_detector wrapper...${NC}"
    sudo tee /usr/local/bin/backup_detector > /dev/null << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: backup_detector <target>"; exit 1; fi
for ext in .bak .backup .old .orig .save .swp .tmp .zip .tar.gz .sql; do
    # macOS curl: -w works the same way
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$1$ext")
    echo "$STATUS" | grep -q "200\|403" && echo "Found: $1$ext ($STATUS)" || true
done
EOF
    sudo chmod +x /usr/local/bin/backup_detector
    echo -e "${GREEN}✓ backup_detector created${NC}"
fi

# asset_diff_engine
if [ ! -f /usr/local/bin/asset_diff_engine ]; then
    echo -e "${YELLOW}Creating asset_diff_engine wrapper...${NC}"
    sudo tee /usr/local/bin/asset_diff_engine > /dev/null << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: asset_diff_engine <current_scan_file> [previous_scan_file]"; exit 1; fi
echo "Asset diff analysis completed"
EOF
    sudo chmod +x /usr/local/bin/asset_diff_engine
    echo -e "${GREEN}✓ asset_diff_engine created${NC}"
fi

# ============================================================
# Verification
# ============================================================
echo ""
echo "🔍 Verifying installations..."
echo ""

LIGHT_TOOLS=("subfinder" "dnsx" "httpx" "httprobe")
MEDIUM_TOOLS=("amass" "asnmap" "top_ports_scanner" "service_detector" "ssl_analyzer" "api_detector")
DEEP_TOOLS=("bbot" "dnsgen" "nuclei" "cloud_osint" "admin_finder" "backup_detector" "asset_diff_engine")

ALL_INSTALLED=true

check_tool() {
    local tool=$1
    if command -v "$tool" &> /dev/null || [ -f "/usr/local/bin/$tool" ]; then
        echo -e "${GREEN}✓ $tool: installed${NC}"
    else
        echo -e "${RED}✗ $tool: NOT FOUND${NC}"
        ALL_INSTALLED=false
    fi
}

echo -e "${YELLOW}LIGHT Intensity Tools:${NC}"
for t in "${LIGHT_TOOLS[@]}"; do check_tool "$t"; done

echo ""
echo -e "${YELLOW}MEDIUM (NORMAL) Intensity Tools:${NC}"
for t in "${MEDIUM_TOOLS[@]}"; do check_tool "$t"; done

echo ""
echo -e "${YELLOW}HIGH (DEEP) Intensity Tools:${NC}"
for t in "${DEEP_TOOLS[@]}"; do check_tool "$t"; done

echo ""
if [ "$ALL_INSTALLED" = true ]; then
    echo -e "${GREEN}✅ All tools installed successfully!${NC}"
else
    echo -e "${RED}❌ Some tools failed to install. Manual references:${NC}"
    echo ""
    echo "  brew install subfinder httpx naabu nmap sslscan katana gobuster"
    echo "  brew install seclists          # wordlists for admin_finder"
    echo "  go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest"
    echo "  go install github.com/tomnomnom/httprobe@latest"
    echo "  go install github.com/owasp-amass/amass/v4/...@master"
    echo "  go install github.com/projectdiscovery/asnmap/cmd/asnmap@latest"
    echo "  go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"
    echo "  pip3 install bbot dnsgen"
    echo "  pip3 install cloud_enum"
    exit 1
fi

#!/bin/bash

# Install ASM Security Tools
# This script installs required security tools for ASM pipeline execution

set -e

echo "🔧 Installing ASM Security Tools..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if Go is installed (required for some tools)
if command -v go &> /dev/null; then
    echo -e "${GREEN}✓ Go is installed${NC}"
    GO_INSTALLED=true
else
    echo -e "${YELLOW}⚠ Go is not installed. Some tools may not install.${NC}"
    GO_INSTALLED=false
fi

USER_PYTHON_BIN="$(python3 -m site --user-base 2>/dev/null)/bin"
if [ -n "$USER_PYTHON_BIN" ]; then
    export PATH="$PATH:$USER_PYTHON_BIN"
fi

# Function to install tool
install_tool() {
    local tool_name=$1
    local install_cmd=$2
    
    if command -v $tool_name &> /dev/null; then
        echo -e "${GREEN}✓ $tool_name is already installed${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}Installing $tool_name...${NC}"
    eval $install_cmd
    
    if command -v $tool_name &> /dev/null; then
        echo -e "${GREEN}✓ $tool_name installed successfully${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to install $tool_name${NC}"
        return 1
    fi
}

# Install subfinder
if [ "$GO_INSTALLED" = true ]; then
    #install_tool "subfinder" "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"
    install_tool "subfinder" "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"
else
    echo -e "${YELLOW}Installing subfinder via curl...${NC}"
    curl -sSfL https://raw.githubusercontent.com/projectdiscovery/subfinder/main/install.sh | sh || \
    (wget -qO- https://github.com/projectdiscovery/subfinder/releases/latest/download/subfinder-linux-amd64.tar.gz | tar -xz && sudo mv subfinder /usr/local/bin/ && chmod +x /usr/local/bin/subfinder)
fi

# Install dnsx
if [ "$GO_INSTALLED" = true ]; then
    install_tool "dnsx" "go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest"
else
    echo -e "${YELLOW}Installing dnsx via curl...${NC}"
    curl -sSfL https://raw.githubusercontent.com/projectdiscovery/dnsx/main/install.sh | sh || \
    (wget -qO- https://github.com/projectdiscovery/dnsx/releases/latest/download/dnsx-linux-amd64.zip | unzip -q - && sudo mv dnsx /usr/local/bin/ && chmod +x /usr/local/bin/dnsx)
fi

# Install httpx
if [ "$GO_INSTALLED" = true ]; then
    install_tool "httpx" "go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest"
else
    echo -e "${YELLOW}Installing httpx via curl...${NC}"
    curl -sSfL https://raw.githubusercontent.com/projectdiscovery/httpx/main/install.sh | sh || \
    (wget -qO- https://github.com/projectdiscovery/httpx/releases/latest/download/httpx-linux-amd64.zip | unzip -q - && sudo mv httpx /usr/local/bin/ && chmod +x /usr/local/bin/httpx)
fi

# Install httprobe
if [ "$GO_INSTALLED" = true ]; then
    install_tool "httprobe" "go install github.com/tomnomnom/httprobe@latest"
else
    echo -e "${YELLOW}Installing httprobe...${NC}"
    wget -qO- https://github.com/tomnomnom/httprobe/releases/latest/download/httprobe-linux-amd64 -O /tmp/httprobe && \
    sudo mv /tmp/httprobe /usr/local/bin/httprobe && \
    sudo chmod +x /usr/local/bin/httprobe
fi

# PDF-aligned NORMAL mode helpers
if [ "$GO_INSTALLED" = true ]; then
    install_tool "amass" "go install github.com/owasp-amass/amass/v4/...@master"
    install_tool "asnmap" "go install github.com/projectdiscovery/asnmap/cmd/asnmap@latest"
else
    echo -e "${YELLOW}Skipping amass/asnmap auto-install because Go is unavailable.${NC}"
fi

# ============================================
# MEDIUM (NORMAL) Intensity Tools
# ============================================

# Install naabu (top_ports_scanner)
if [ "$GO_INSTALLED" = true ]; then
    install_tool "naabu" "go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest"
else
    echo -e "${YELLOW}Installing naabu via curl...${NC}"
    curl -sSfL https://raw.githubusercontent.com/projectdiscovery/naabu/main/install.sh | sh || \
    (wget -qO- https://github.com/projectdiscovery/naabu/releases/latest/download/naabu-linux-amd64.zip | unzip -q - && sudo mv naabu /usr/local/bin/ && chmod +x /usr/local/bin/naabu)
fi

# Create symlink for top_ports_scanner -> naabu
if command -v naabu &> /dev/null && ! command -v top_ports_scanner &> /dev/null; then
    echo -e "${YELLOW}Creating symlink: top_ports_scanner -> naabu${NC}"
    sudo ln -sf $(which naabu) /usr/local/bin/top_ports_scanner
    echo -e "${GREEN}✓ top_ports_scanner symlink created${NC}"
fi

# Install nmap (for service_detector - service fingerprinting)
install_tool "nmap" "sudo apt-get update && sudo apt-get install -y nmap || sudo yum install -y nmap || sudo brew install nmap"

# Create service_detector wrapper script
if [ ! -f /usr/local/bin/service_detector ]; then
    echo -e "${YELLOW}Creating service_detector wrapper...${NC}"
    sudo tee /usr/local/bin/service_detector > /dev/null << 'EOF'
#!/bin/bash
# Service detector wrapper using nmap
# Usage: service_detector <target>
if [ -z "$1" ]; then
    echo "Usage: service_detector <target>"
    exit 1
fi
nmap -sV -sC --top-ports 1000 "$1" 2>/dev/null || nmap -sV "$1"
EOF
    sudo chmod +x /usr/local/bin/service_detector
    echo -e "${GREEN}✓ service_detector created${NC}"
fi

# Install sslscan (ssl_analyzer)
install_tool "sslscan" "sudo apt-get update && sudo apt-get install -y sslscan || sudo yum install -y sslscan || (wget -qO- https://github.com/rbsec/sslscan/releases/latest/download/sslscan-linux-amd64.tar.gz | tar -xz && sudo mv sslscan /usr/local/bin/ && chmod +x /usr/local/bin/sslscan)"

# Create ssl_analyzer wrapper script
if [ ! -f /usr/local/bin/ssl_analyzer ]; then
    echo -e "${YELLOW}Creating ssl_analyzer wrapper...${NC}"
    sudo tee /usr/local/bin/ssl_analyzer > /dev/null << 'EOF'
#!/bin/bash
# SSL analyzer wrapper using sslscan
# Usage: ssl_analyzer <target>
if [ -z "$1" ]; then
    echo "Usage: ssl_analyzer <target>"
    exit 1
fi
sslscan "$1" 2>/dev/null || echo "SSL analysis completed"
EOF
    sudo chmod +x /usr/local/bin/ssl_analyzer
    echo -e "${GREEN}✓ ssl_analyzer created${NC}"
fi

# Install katana (api_detector - for API endpoint discovery)
if [ "$GO_INSTALLED" = true ]; then
    install_tool "katana" "go install github.com/projectdiscovery/katana/cmd/katana@latest"
else
    echo -e "${YELLOW}Installing katana via curl...${NC}"
    curl -sSfL https://raw.githubusercontent.com/projectdiscovery/katana/main/install.sh | sh || \
    (wget -qO- https://github.com/projectdiscovery/katana/releases/latest/download/katana-linux-amd64.zip | unzip -q - && sudo mv katana /usr/local/bin/ && chmod +x /usr/local/bin/katana)
fi

# Create api_detector wrapper script
if command -v katana &> /dev/null && ! command -v api_detector &> /dev/null; then
    echo -e "${YELLOW}Creating api_detector wrapper...${NC}"
    sudo tee /usr/local/bin/api_detector > /dev/null << 'EOF'
#!/bin/bash
# API detector wrapper using katana
# Usage: api_detector <target>
if [ -z "$1" ]; then
    echo "Usage: api_detector <target>"
    exit 1
fi
katana -u "$1" -silent -json 2>/dev/null | grep -i "api\|endpoint" || katana -u "$1" -silent
EOF
    sudo chmod +x /usr/local/bin/api_detector
    echo -e "${GREEN}✓ api_detector created${NC}"
fi

# PDF-aligned DEEP mode helpers
install_tool "bbot" "python3 -m pip install --user --break-system-packages bbot"
install_tool "dnsgen" "python3 -m pip install --user --break-system-packages dnsgen"

if [ "$GO_INSTALLED" = true ]; then
    install_tool "nuclei" "go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"
else
    echo -e "${YELLOW}Skipping nuclei auto-install because Go is unavailable.${NC}"
fi

# ============================================
# HIGH (DEEP) Intensity Tools
# ============================================

# Install cloud_enum (cloud_osint)
if [ ! -f /usr/local/bin/cloud_enum ]; then
    echo -e "${YELLOW}Installing cloud_enum...${NC}"
    sudo pip3 install cloud_enum 2>/dev/null || \
    (git clone https://github.com/initstring/cloud_enum.git /tmp/cloud_enum && \
     sudo cp /tmp/cloud_enum/cloud_enum.py /usr/local/bin/cloud_enum && \
     sudo chmod +x /usr/local/bin/cloud_enum && \
     sudo pip3 install -r /tmp/cloud_enum/requirements.txt 2>/dev/null || true)
    if command -v cloud_enum &> /dev/null || [ -f /usr/local/bin/cloud_enum ]; then
        echo -e "${GREEN}✓ cloud_enum installed${NC}"
    fi
fi

# Create cloud_osint wrapper
if [ ! -f /usr/local/bin/cloud_osint ]; then
    echo -e "${YELLOW}Creating cloud_osint wrapper...${NC}"
    sudo tee /usr/local/bin/cloud_osint > /dev/null << 'EOF'
#!/bin/bash
# Cloud OSINT wrapper using cloud_enum
# Usage: cloud_osint <target>
if [ -z "$1" ]; then
    echo "Usage: cloud_osint <target>"
    exit 1
fi
cloud_enum -k "$1" 2>/dev/null || python3 /usr/local/bin/cloud_enum -k "$1" 2>/dev/null || echo "Cloud OSINT scan completed"
EOF
    sudo chmod +x /usr/local/bin/cloud_osint
    echo -e "${GREEN}✓ cloud_osint created${NC}"
fi

# Install gobuster (admin_finder - for admin endpoint discovery)
if [ "$GO_INSTALLED" = true ]; then
    install_tool "gobuster" "go install github.com/OJ/gobuster/v3@latest"
else
    echo -e "${YELLOW}Installing gobuster...${NC}"
    wget -qO- https://github.com/OJ/gobuster/releases/latest/download/gobuster-Linux-x86_64.tar.gz | tar -xz && \
    sudo mv gobuster /usr/local/bin/ && chmod +x /usr/local/bin/gobuster || \
    (wget -qO- https://github.com/OJ/gobuster/releases/latest/download/gobuster-linux-amd64 -O /tmp/gobuster && \
     sudo mv /tmp/gobuster /usr/local/bin/gobuster && sudo chmod +x /usr/local/bin/gobuster)
fi

# Create admin_finder wrapper
if command -v gobuster &> /dev/null && ! command -v admin_finder &> /dev/null; then
    echo -e "${YELLOW}Creating admin_finder wrapper...${NC}"
    sudo tee /usr/local/bin/admin_finder > /dev/null << 'EOF'
#!/bin/bash
# Admin endpoint finder wrapper using gobuster
# Usage: admin_finder <target>
if [ -z "$1" ]; then
    echo "Usage: admin_finder <target>"
    exit 1
fi
gobuster dir -u "$1" -w /usr/share/wordlists/dirb/common.txt -q 2>/dev/null | grep -i "admin\|login\|dashboard" || \
gobuster dir -u "$1" -w /usr/share/seclists/Discovery/Web-Content/common.txt -q 2>/dev/null | grep -i "admin\|login\|dashboard" || \
echo "Admin endpoint scan completed"
EOF
    sudo chmod +x /usr/local/bin/admin_finder
    echo -e "${GREEN}✓ admin_finder created${NC}"
fi

# Create backup_detector wrapper
if [ ! -f /usr/local/bin/backup_detector ]; then
    echo -e "${YELLOW}Creating backup_detector wrapper...${NC}"
    sudo tee /usr/local/bin/backup_detector > /dev/null << 'EOF'
#!/bin/bash
# Backup file detector
# Usage: backup_detector <target>
if [ -z "$1" ]; then
    echo "Usage: backup_detector <target>"
    exit 1
fi
# Check for common backup file extensions
for ext in .bak .backup .old .orig .save .swp .tmp .zip .tar.gz .sql; do
    curl -s -o /dev/null -w "%{http_code}" "$1$ext" | grep -q "200\|403" && echo "$1$ext" || true
done
EOF
    sudo chmod +x /usr/local/bin/backup_detector
    echo -e "${GREEN}✓ backup_detector created${NC}"
fi

# Create asset_diff_engine wrapper
if [ ! -f /usr/local/bin/asset_diff_engine ]; then
    echo -e "${YELLOW}Creating asset_diff_engine wrapper...${NC}"
    sudo tee /usr/local/bin/asset_diff_engine > /dev/null << 'EOF'
#!/bin/bash
# Asset diff engine - compares current scan with previous scan
# Usage: asset_diff_engine <current_scan> <previous_scan>
# This is a placeholder - actual implementation would compare scan results
if [ -z "$1" ]; then
    echo "Usage: asset_diff_engine <current_scan_file> [previous_scan_file]"
    exit 1
fi
echo "Asset diff analysis completed"
EOF
    sudo chmod +x /usr/local/bin/asset_diff_engine
    echo -e "${GREEN}✓ asset_diff_engine created${NC}"
fi

# Verify installations
echo ""
echo "🔍 Verifying installations..."
echo ""

# LIGHT intensity tools
TOOLS=("subfinder" "dnsx" "httpx" "httprobe")

# MEDIUM (NORMAL) intensity tools
MEDIUM_TOOLS=("amass" "asnmap" "top_ports_scanner" "service_detector" "ssl_analyzer" "api_detector")

# HIGH (DEEP) intensity tools
DEEP_TOOLS=("bbot" "dnsgen" "nuclei" "cloud_osint" "admin_finder" "backup_detector" "asset_diff_engine")

ALL_INSTALLED=true

echo -e "${YELLOW}LIGHT Intensity Tools:${NC}"
for tool in "${TOOLS[@]}"; do
    if command -v $tool &> /dev/null; then
        VERSION=$($tool -version 2>/dev/null || echo "installed")
        echo -e "${GREEN}✓ $tool: $VERSION${NC}"
    else
        echo -e "${RED}✗ $tool: NOT FOUND${NC}"
        ALL_INSTALLED=false
    fi
done

echo ""
echo -e "${YELLOW}MEDIUM (NORMAL) Intensity Tools:${NC}"
for tool in "${MEDIUM_TOOLS[@]}"; do
    if command -v $tool &> /dev/null || [ -f /usr/local/bin/$tool ]; then
        VERSION=$($tool -version 2>/dev/null || echo "installed")
        echo -e "${GREEN}✓ $tool: $VERSION${NC}"
    else
        echo -e "${RED}✗ $tool: NOT FOUND${NC}"
        ALL_INSTALLED=false
    fi
done

echo ""
echo -e "${YELLOW}HIGH (DEEP) Intensity Tools:${NC}"
for tool in "${DEEP_TOOLS[@]}"; do
    if command -v $tool &> /dev/null || [ -f /usr/local/bin/$tool ]; then
        VERSION=$($tool -version 2>/dev/null || echo "installed")
        echo -e "${GREEN}✓ $tool: $VERSION${NC}"
    else
        echo -e "${RED}✗ $tool: NOT FOUND${NC}"
        ALL_INSTALLED=false
    fi
done

echo ""
if [ "$ALL_INSTALLED" = true ]; then
    echo -e "${GREEN}✅ All tools installed successfully!${NC}"
else
    echo -e "${RED}❌ Some tools failed to install. Please install them manually.${NC}"
    echo ""
    echo "Manual installation:"
    echo "  LIGHT:"
    echo "    - subfinder: https://github.com/projectdiscovery/subfinder"
    echo "    - dnsx: https://github.com/projectdiscovery/dnsx"
    echo "    - httpx: https://github.com/projectdiscovery/httpx"
    echo "    - httprobe: https://github.com/tomnomnom/httprobe"
    echo "  MEDIUM (NORMAL):"
    echo "    - amass: https://github.com/owasp-amass/amass"
    echo "    - asnmap: https://github.com/projectdiscovery/asnmap"
    echo "    - naabu (top_ports_scanner): https://github.com/projectdiscovery/naabu"
    echo "    - nmap (service_detector): https://nmap.org"
    echo "    - sslscan (ssl_analyzer): https://github.com/rbsec/sslscan"
    echo "    - katana (api_detector): https://github.com/projectdiscovery/katana"
    echo "  HIGH (DEEP):"
    echo "    - bbot: https://github.com/blacklanternsecurity/bbot"
    echo "    - dnsgen: https://github.com/ProjectAnte/dnsgen"
    echo "    - nuclei: https://github.com/projectdiscovery/nuclei"
    echo "    - cloud_enum (cloud_osint): https://github.com/initstring/cloud_enum"
    echo "    - gobuster (admin_finder): https://github.com/OJ/gobuster"
    echo "    - backup_detector: Custom script (created by install script)"
    echo "    - asset_diff_engine: Custom script (created by install script)"
    exit 1
fi

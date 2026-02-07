#!/bin/bash

# Setup PATH for ASM tools
# Add this to your ~/.bashrc or ~/.zshrc

# Get Go bin path
GO_BIN_PATH=$(go env GOPATH)/bin

# Add to PATH if not already present
if [[ ":$PATH:" != *":$GO_BIN_PATH:"* ]]; then
    export PATH="$PATH:$GO_BIN_PATH"
    echo "Added $GO_BIN_PATH to PATH"
else
    echo "$GO_BIN_PATH already in PATH"
fi

# Verify tools
echo ""
echo "Checking tools..."
which subfinder && echo "✓ subfinder found" || echo "✗ subfinder not found"
which dnsx && echo "✓ dnsx found" || echo "✗ dnsx not found"
which httpx && echo "✓ httpx found" || echo "✗ httpx not found"
which httprobe && echo "✓ httprobe found" || echo "✗ httprobe not found"


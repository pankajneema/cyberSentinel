#!/bin/bash

# CyberSentinel Start Script - Fixed for Docker Compose v2

set -e

echo "🚀 Starting CyberSentinel..."

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Docker Compose
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
    echo -e "${GREEN}Using Docker Compose v2${NC}"
elif docker-compose --version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
    echo -e "${GREEN}Using Docker Compose v1${NC}"
else
    echo "❌ Docker Compose not found. Please install Docker Compose."
    exit 1
fi

# Verify docker-compose.yml exists
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ docker-compose.yml not found in current directory: $(pwd)"
    exit 1
fi

echo -e "${BLUE}Starting infrastructure services...${NC}"
$DOCKER_COMPOSE --file "$SCRIPT_DIR/docker-compose.yml" up -d postgres redis clickhouse

echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 10

echo -e "${BLUE}Starting Auth Service...${NC}"
$DOCKER_COMPOSE --file "$SCRIPT_DIR/docker-compose.yml" up -d auth-service

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Services started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Frontend:${NC}    http://localhost:3000 (run: cd frontend && npm run dev)"
echo -e "${BLUE}API Docs:${NC}     http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}To view logs:${NC} $DOCKER_COMPOSE --file \"$SCRIPT_DIR/docker-compose.yml\" logs -f"
echo -e "${YELLOW}To stop:${NC}     $DOCKER_COMPOSE --file \"$SCRIPT_DIR/docker-compose.yml\" down"
echo ""


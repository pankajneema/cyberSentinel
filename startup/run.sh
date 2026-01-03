#!/bin/bash

# CyberSentinel Quick Start Script

set -e

echo "🚀 Starting CyberSentinel..."

# Get absolute path to script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed. Aborting." >&2; exit 1; }
# Check for docker compose (v2) or docker-compose (v1)
if ! docker compose version >/dev/null 2>&1 && ! docker-compose --version >/dev/null 2>&1; then
    echo "❌ Docker Compose is required but not installed. Aborting." >&2
    exit 1
fi

# Use docker compose (v2) if available, otherwise docker-compose (v1)
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
    echo -e "${GREEN}Using Docker Compose v2${NC}"
else
    DOCKER_COMPOSE="docker-compose"
    echo -e "${GREEN}Using Docker Compose v1${NC}"
fi

# Check if docker-compose.yml exists
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}❌ docker-compose.yml not found in: $SCRIPT_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites met!${NC}"
echo -e "${BLUE}Working directory: $SCRIPT_DIR${NC}"
echo -e "${BLUE}Compose file: $COMPOSE_FILE${NC}"

# Start infrastructure services
echo -e "${BLUE}Starting infrastructure services (PostgreSQL, Redis, ClickHouse)...${NC}"

# Try with explicit file path first
if $DOCKER_COMPOSE -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
    echo -e "${GREEN}Using explicit file path${NC}"
    $DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d postgres redis clickhouse
else
    # If that fails, try without -f (might work if in correct directory)
    echo -e "${YELLOW}⚠️  Trying without explicit file path...${NC}"
    if $DOCKER_COMPOSE up -d postgres redis clickhouse 2>&1 | grep -q "no configuration file"; then
        echo -e "${RED}❌ Docker Compose cannot access docker-compose.yml${NC}"
        echo -e "${YELLOW}This is likely a Docker snap permission issue.${NC}"
        echo ""
        echo -e "${BLUE}Quick Fix Options:${NC}"
        echo -e "1. ${GREEN}Fix snap permissions:${NC} sudo snap connect docker:home"
        echo -e "2. ${GREEN}Use manual Docker commands:${NC}"
        echo ""
        echo "   docker run -d --name cybersentinel-postgres \\"
        echo "     -e POSTGRES_DB=cybersentinel \\"
        echo "     -e POSTGRES_USER=postgres \\"
        echo "     -e POSTGRES_PASSWORD=postgres \\"
        echo "     -p 5432:5432 postgres:15-alpine"
        echo ""
        echo "   docker run -d --name cybersentinel-redis -p 6379:6379 redis:7-alpine"
        echo ""
        echo "   docker run -d --name cybersentinel-clickhouse \\"
        echo "     -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server:latest"
        echo ""
        echo -e "3. ${GREEN}Or just run the frontend:${NC} cd frontend && npm install && npm run dev"
        exit 1
    fi
fi

echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 10

# Check if services are healthy
if docker ps | grep -q cybersentinel-postgres; then
    echo -e "${GREEN}✅ PostgreSQL is running${NC}"
else
    echo -e "${YELLOW}⚠️  PostgreSQL may not be ready yet${NC}"
fi

# Install frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${BLUE}Installing frontend dependencies...${NC}"
    cd frontend
    npm install
    cd ..
else
    echo -e "${GREEN}✅ Frontend dependencies already installed${NC}"
fi

# Start backend service
echo -e "${BLUE}Starting Auth Service...${NC}"
if $DOCKER_COMPOSE -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
    $DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d auth-service
else
    if ! $DOCKER_COMPOSE up -d auth-service 2>&1; then
        echo -e "${YELLOW}⚠️  Auth service failed to start. You can start it manually later.${NC}"
    fi
fi

# Wait a bit for backend to start
sleep 5

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 CyberSentinel is starting!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Frontend:${NC}    http://localhost:3000"
echo -e "${BLUE}API Docs:${NC}     http://localhost:8000/docs"
echo -e "${BLUE}PostgreSQL:${NC}   localhost:5432"
echo ""
echo -e "${YELLOW}To start the frontend, run:${NC}"
echo -e "  ${GREEN}cd frontend && npm run dev${NC}"
echo ""
echo -e "${YELLOW}To view logs:${NC}"
echo -e "  ${GREEN}$DOCKER_COMPOSE logs -f${NC}"
echo ""
echo -e "${YELLOW}To stop all services:${NC}"
echo -e "  ${GREEN}$DOCKER_COMPOSE down${NC}"
echo ""


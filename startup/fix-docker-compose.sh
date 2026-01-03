#!/bin/bash

# Fix for Docker Compose with snap installation

SCRIPT_DIR="/pnkj/CyberCurious"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "Using absolute path: $COMPOSE_FILE"

# Try Docker Compose v2 with absolute path
if docker compose version >/dev/null 2>&1; then
    echo "Using Docker Compose v2"
    docker compose -f "$COMPOSE_FILE" up -d postgres redis clickhouse
    docker compose -f "$COMPOSE_FILE" up -d auth-service
elif docker-compose --version >/dev/null 2>&1; then
    echo "Using Docker Compose v1"
    docker-compose -f "$COMPOSE_FILE" up -d postgres redis clickhouse
    docker-compose -f "$COMPOSE_FILE" up -d auth-service
else
    echo "Docker Compose not found!"
    exit 1
fi

echo "✅ Services started!"
echo "Frontend: cd frontend && npm run dev"
echo "API Docs: http://localhost:8000/docs"


#!/bin/bash

# Alternative startup script using direct Docker commands
# Use this if docker-compose has permission issues

echo "🚀 Starting CyberSentinel services with direct Docker commands..."

# Start PostgreSQL
echo "Starting PostgreSQL..."
docker run -d --name cybersentinel-postgres \
  -e POSTGRES_DB=cybersentinel \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine

# Start Redis
echo "Starting Redis..."
docker run -d --name cybersentinel-redis \
  -p 6379:6379 \
  redis:7-alpine

# Start ClickHouse
echo "Starting ClickHouse..."
docker run -d --name cybersentinel-clickhouse \
  -p 8123:8123 \
  -p 9000:9000 \
  clickhouse/clickhouse-server:latest

echo ""
echo "✅ Services started!"
echo "PostgreSQL: localhost:5432"
echo "Redis: localhost:6379"
echo "ClickHouse: localhost:8123"
echo ""
echo "To stop services: docker stop cybersentinel-postgres cybersentinel-redis cybersentinel-clickhouse"
echo "To remove: docker rm cybersentinel-postgres cybersentinel-redis cybersentinel-clickhouse"


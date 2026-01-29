#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Creating Workers Directory Structure...${NC}\n"

# Base directory
BASE_DIR="workers"

# Create config
mkdir -p $BASE_DIR/config
touch $BASE_DIR/config/config.go
touch $BASE_DIR/config/env.go

# Create utils
mkdir -p $BASE_DIR/utils
touch $BASE_DIR/utils/queue.go
touch $BASE_DIR/utils/logger.go
touch $BASE_DIR/utils/errors.go
touch $BASE_DIR/utils/validation.go

# Create triggers
mkdir -p $BASE_DIR/triggers/handlers
mkdir -p $BASE_DIR/triggers/health
touch $BASE_DIR/triggers/main.go
touch $BASE_DIR/triggers/dispatcher.go
touch $BASE_DIR/triggers/handlers/job.go
touch $BASE_DIR/triggers/handlers/task.go
touch $BASE_DIR/triggers/health/checker.go
touch $BASE_DIR/triggers/README.md

# Create control-plane
mkdir -p $BASE_DIR/control-plane/api/middleware
mkdir -p $BASE_DIR/control-plane/api/handlers
mkdir -p $BASE_DIR/control-plane/websocket
mkdir -p $BASE_DIR/control-plane/jobs
touch $BASE_DIR/control-plane/main.go
touch $BASE_DIR/control-plane/api/server.go
touch $BASE_DIR/control-plane/api/router.go
touch $BASE_DIR/control-plane/api/middleware/auth.go
touch $BASE_DIR/control-plane/api/middleware/cors.go
touch $BASE_DIR/control-plane/api/middleware/logging.go
touch $BASE_DIR/control-plane/api/handlers/jobs.go
touch $BASE_DIR/control-plane/api/handlers/tasks.go
touch $BASE_DIR/control-plane/api/handlers/health.go
touch $BASE_DIR/control-plane/websocket/hub.go
touch $BASE_DIR/control-plane/websocket/client.go
touch $BASE_DIR/control-plane/websocket/events.go
touch $BASE_DIR/control-plane/jobs/manager.go
touch $BASE_DIR/control-plane/jobs/state.go
touch $BASE_DIR/control-plane/jobs/store.go
touch $BASE_DIR/control-plane/jobs/registry.go
touch $BASE_DIR/control-plane/jobs/types.go
touch $BASE_DIR/control-plane/README.md

# Create executor
mkdir -p $BASE_DIR/executor/pool
mkdir -p $BASE_DIR/executor/runner
mkdir -p $BASE_DIR/executor/profiles/asm
mkdir -p $BASE_DIR/executor/tools/subdomain
mkdir -p $BASE_DIR/executor/tools/dns
mkdir -p $BASE_DIR/executor/tools/http
mkdir -p $BASE_DIR/executor/tools/common
mkdir -p $BASE_DIR/executor/events
touch $BASE_DIR/executor/main.go
touch $BASE_DIR/executor/pool/manager.go
touch $BASE_DIR/executor/pool/worker.go
touch $BASE_DIR/executor/runner/task.go
touch $BASE_DIR/executor/runner/context.go
touch $BASE_DIR/executor/profiles/asm/discovery.go
touch $BASE_DIR/executor/profiles/asm/config.go
touch $BASE_DIR/executor/profiles/asm/types.go
touch $BASE_DIR/executor/tools/registry.go
touch $BASE_DIR/executor/tools/executor.go
touch $BASE_DIR/executor/tools/subdomain/subfinder.go
touch $BASE_DIR/executor/tools/subdomain/amass.go
touch $BASE_DIR/executor/tools/subdomain/crtsh.go
touch $BASE_DIR/executor/tools/dns/dnsx.go
touch $BASE_DIR/executor/tools/http/httpx.go
touch $BASE_DIR/executor/tools/common/exec.go
touch $BASE_DIR/executor/tools/common/timeout.go
touch $BASE_DIR/executor/tools/common/parser.go
touch $BASE_DIR/executor/tools/common/normalize.go
touch $BASE_DIR/executor/events/emitter.go
touch $BASE_DIR/executor/events/types.go
touch $BASE_DIR/executor/README.md

# Create root files
touch $BASE_DIR/.env.example
touch $BASE_DIR/README.md

echo -e "${GREEN}✓ Directory structure created successfully!${NC}\n"

# Display tree structure
echo -e "${BLUE}Directory Structure:${NC}"
tree $BASE_DIR -L 3 2>/dev/null || find $BASE_DIR -type d | sed 's|[^/]*/|  |g'

echo -e "\n${GREEN}Done! 🚀${NC}"

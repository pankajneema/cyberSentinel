#!/usr/bin/env bash
#
# CyberSentinel — run every service for local development.
#
#   ./scripts/dev.sh
#
# Starts (with prefixed, colorised logs) and stops them all together on Ctrl+C:
#   • api          FastAPI API service        http://localhost:8000   (/docs)
#   • control-plane Go control-plane + worker  http://localhost:8090   (gin API + executor)
#   • consumer      Go ASM queue consumer
#   • reporting     Python reporting consumer  (RabbitMQ -> Postgres)
#   • frontend      Vite dev server            http://localhost:8080
#
# Prerequisites (NOT started by this script — bring them up first):
#   Postgres (5432), Redis (6379), RabbitMQ (5672) — e.g.:
#       docker compose up -d postgres redis rabbitmq
#   and the env files: backend/api_service/.env, backend/workers/.env, frontend/.env
#
set -uo pipefail
# Repo root is the parent of this script's dir (scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---- config ----------------------------------------------------------------
API_DIR="$ROOT/backend/api_service"
WORKERS_DIR="$ROOT/backend/workers"
VENV="$API_DIR/venv"

# Reporting needs all three on PYTHONPATH (matches its Dockerfile setup) so both
# `backend.*` and `config.*`/`utils.*` style imports resolve.
REPORT_PYTHONPATH="$ROOT:$ROOT/backend:$API_DIR"

pids=()

cleanup() {
  echo
  echo "▶ stopping all services…"
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  # kill whole process groups (uvicorn/vite/go spawn children)
  for p in "${pids[@]}"; do pkill -P "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# run NAME COLOR -- <command...>   (logs each line prefixed with [NAME])
run() {
  local name="$1" color="$2"; shift 3
  ( "$@" 2>&1 | sed -u "s/^/$(printf '\033[%sm[%s]\033[0m ' "$color" "$name")/" ) &
  pids+=($!)
}

# ---- preflight -------------------------------------------------------------
[ -f "$API_DIR/.env" ]      || echo "⚠  missing $API_DIR/.env"
[ -f "$WORKERS_DIR/.env" ]  || echo "⚠  missing $WORKERS_DIR/.env"
[ -f "$ROOT/frontend/.env" ] || echo "⚠  missing frontend/.env"

PY="python3"
if [ -x "$VENV/bin/python" ]; then PY="$VENV/bin/python"; fi

echo "▶ starting CyberSentinel services (Ctrl+C to stop all)…"

# 1) FastAPI API service (loads its own .env via settings.py)
run api 36 -- bash -c "cd '$API_DIR' && '$PY' -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"

# 2) Go control-plane / gin API + worker executor (export workers/.env first)
run control-plane 35 -- bash -c "cd '$WORKERS_DIR' && set -a && [ -f .env ] && . ./.env; set +a && go run ./control-plane/cmd/"

# 3) Go ASM queue consumer
run consumer 33 -- bash -c "cd '$WORKERS_DIR' && set -a && [ -f .env ] && . ./.env; set +a && go run ./consumer/cmd/asm/"

# 4) Python reporting consumer
run reporting 32 -- bash -c "cd '$ROOT' && PYTHONPATH='$REPORT_PYTHONPATH' '$PY' backend/reporting/asm/main.py"

# 5) Frontend (Vite, reads frontend/.env)
run frontend 34 -- bash -c "cd '$ROOT/frontend' && npm run dev"

echo "▶ api:8000  control-plane:8090  frontend:8080  (consumer + reporting are queue workers)"
wait

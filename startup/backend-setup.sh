#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

export PYTHONPATH="$ROOT_DIR/backend/api_service:$ROOT_DIR"

echo "[1/5] Setting up api_service venv + deps"
python3 -m venv "$ROOT_DIR/backend/api_service/.venv"
source "$ROOT_DIR/backend/api_service/.venv/bin/activate"
pip install --upgrade pip
pip install -r "$ROOT_DIR/backend/api_service/requirements.txt"

echo "[2/5] Running api_service migration (create tables)"
python3 "$ROOT_DIR/backend/api_service/migration.py"

echo "[3/5] Starting api_service (uvicorn)"
nohup uvicorn main:app --host 0.0.0.0 --port 8000 \
  --app-dir "$ROOT_DIR/backend/api_service" \
  > "$LOG_DIR/api_service.log" 2>&1 &

sleep 2

echo "[4/5] Starting reporting consumer"
nohup python3 "$ROOT_DIR/backend/reporting/asm/main.py" \
  > "$LOG_DIR/reporting.log" 2>&1 &

sleep 1

echo "[5/5] Starting workers (control-plane + consumer)"
(
  cd "$ROOT_DIR/backend/workers"
  go mod download
  nohup go run ./control-plane/cmd/ > "$LOG_DIR/control-plane.log" 2>&1 &
  nohup go run ./consumer/cmd/ > "$LOG_DIR/consumer.log" 2>&1 &
)

echo "✅ Backend stack started"
echo "Logs: $LOG_DIR"

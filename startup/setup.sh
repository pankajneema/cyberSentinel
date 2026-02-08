#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/4] api_service deps"
python3 -m venv "$ROOT_DIR/backend/api_service/.venv"
source "$ROOT_DIR/backend/api_service/.venv/bin/activate"
pip install --upgrade pip
pip install -r "$ROOT_DIR/backend/api_service/requirements.txt"

echo "[2/4] reporting deps"
pip install -r "$ROOT_DIR/backend/reporting/requirements.txt"

deactivate || true

echo "[3/4] workers (Go) deps"
(cd "$ROOT_DIR/backend/workers" && go mod download)

echo "[4/4] frontend deps"
(cd "$ROOT_DIR/frontend" && npm ci)

echo "✅ All dependencies installed"

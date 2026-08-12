SHELL := /bin/bash
.DEFAULT_GOAL := help

# Prefer the project venv (.venv-run); fall back to venv/, then system python3.
# Absolute path so it still resolves correctly after a recipe `cd`s elsewhere.
API_DIR := backend/api_service
PY := $(shell [ -x $(CURDIR)/$(API_DIR)/.venv-run/bin/python ] && echo $(CURDIR)/$(API_DIR)/.venv-run/bin/python \
       || ( [ -x $(CURDIR)/$(API_DIR)/venv/bin/python ] && echo $(CURDIR)/$(API_DIR)/venv/bin/python ) \
       || echo python3)

.PHONY: help up down logs restart ps \
        dev run-api run-fe run-worker \
        migrate stamp backfill \
        test test-backend go-test fe-typecheck lint-backend fe-lint \
        install clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## ---- Docker (all services) ------------------------------------------------

up: ## Build + start the full stack in Docker (infra + api + worker + reporting + frontend)
	docker compose up -d --build

down: ## Stop the full stack
	docker compose down

logs: ## Tail logs from every service
	docker compose logs -f

restart: ## Restart the full stack
	docker compose restart

ps: ## Show service status
	docker compose ps

## ---- Hybrid dev (infra in Docker, app services on host with hot-reload) --

dev: ## Run infra in Docker + every app service locally with hot-reload (scripts/dev.sh)
	docker compose up -d postgres redis rabbitmq
	./scripts/dev.sh

run-api: ## Run only the FastAPI API service (uvicorn --reload)
	cd $(API_DIR) && $(PY) -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

run-fe: ## Run only the frontend (Vite dev server)
	cd frontend && npm run dev

run-worker: ## Run only the Go scan-execution worker
	cd worker && go run .

## ---- Database ---------------------------------------------------------

migrate: ## Apply all Alembic migrations (creates/updates schema)
	cd $(API_DIR) && $(PY) -m alembic upgrade head

stamp: ## Mark an existing DB as current WITHOUT running migrations (baseline only)
	cd $(API_DIR) && $(PY) -m alembic stamp head

backfill: ## Backfill org_id on pre-tenancy rows (one-time, idempotent)
	cd $(API_DIR) && $(PY) scripts/backfill_org_id.py

## ---- Tests & lint -------------------------------------------------------

test: test-backend go-test ## Run backend (pytest) + worker (go test) suites

test-backend: ## Run the FastAPI test suite
	cd $(API_DIR) && $(PY) -m pytest

go-test: ## Run the Go worker test suite
	cd worker && go test ./...

fe-typecheck: ## Frontend type-check — the actual CI correctness gate (no test suite)
	cd frontend && npx tsc --noEmit

lint-backend: ## Lint the API/reporting Python code
	cd $(API_DIR) && $(PY) -m ruff check .

fe-lint: ## Lint the frontend
	cd frontend && npm run lint

## ---- Setup / cleanup ----------------------------------------------------

install: ## First-time setup: Python venv + deps, frontend deps
	cd $(API_DIR) && python3 -m venv .venv-run && .venv-run/bin/pip install -r requirements.txt
	cd frontend && npm ci

clean: ## Stop everything and wipe the Postgres volume (destructive — local data loss)
	docker compose down -v

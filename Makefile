# CyberSentinel — common dev commands. See docs/RUN-LOCAL.md.

API := backend/api_service

.PHONY: help run-api run-fe test test-backend lint-backend migrate stamp backfill up down logs build fe-build fe-lint go-build go-test

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

run-api: ## Run the FastAPI backend (reload) on :8000
	cd $(API) && uvicorn main:app --reload --host 0.0.0.0 --port 8000

run-fe: ## Run the frontend dev server on :8080
	cd frontend && npm run dev

test: test-backend go-test ## Run all tests

test-backend: ## Run backend pytest (needs deps installed)
	cd $(API) && pytest

lint-backend: ## Lint backend with ruff
	cd $(API) && ruff check .

migrate: ## Apply Alembic migrations to head
	cd $(API) && alembic upgrade head

stamp: ## Stamp an existing DB with the baseline (no DDL run)
	cd $(API) && alembic stamp 0001_baseline

backfill: ## Backfill org_id on existing rows
	cd $(API) && python scripts/backfill_org_id.py

up: ## Start the full stack
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

logs: ## Tail stack logs
	docker compose logs -f

build: ## Build all images
	docker compose build

fe-build: ## Build the frontend
	cd frontend && npm ci && npm run build

fe-lint: ## Lint the frontend
	cd frontend && npm run lint

go-build: ## Build the Go worker
	cd worker && go build ./...

go-test: ## Test the Go worker
	cd worker && go test ./...

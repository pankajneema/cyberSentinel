# Local Development Setup Guide

> Get the entire CyberSentinel stack running locally from scratch. Two paths: **all-in-Docker** (fastest) or **hybrid** (infra in Docker, app services with hot-reload via `dev.sh`).

**Related:** [Inventory](00_inventory.md) · [Infra Guide](04_infra_and_api_guide/infra.md) · [Developer Guide](01_developer_guide/overview.md)

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Clone & orient](#2-clone--orient)
3. [Environment files](#3-environment-files)
4. [Path A — all in Docker](#4-path-a--everything-in-docker-fastest)
5. [Path B — hybrid with hot-reload](#5-path-b--hybrid-infra-in-docker--apps-with-hot-reload)
6. [Database migrations](#6-database-migrations)
7. [Verify it works](#7-verify-it-works)
8. [Running tests](#8-running-tests)
9. [Common issues & fixes](#9-common-issues--fixes)
10. [Verification checklist](#10-verification-checklist)

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Docker + Docker Compose | recent | infra services (Postgres/Redis/RabbitMQ) and optional full stack |
| Python | 3.11 | api_service, reporting |
| Go | 1.24 | workers |
| Node.js | 20 | frontend |
| A Supabase project | — | identity provider (you need its URL, anon key, JWT secret) |

Scanning tools (only needed if you run the Go control-plane and want real scans): `nmap`, `naabu`, `nuclei`, `subfinder`, `gitleaks` on `PATH`.

## 2. Clone & orient
```bash
git clone <repo-url> cyberSentinel && cd cyberSentinel
```
Orientation (see [Inventory §2](00_inventory.md#2-top-level-services--directories)): `frontend/`, `backend/api_service/`, `backend/workers/`, `backend/reporting/`, `backend/notificationservice/`, `infrastructure/`, `docker-compose.yml`, `dev.sh`, `Makefile`.

## 3. Environment files
Create these from their `.env.example` siblings (names only shown here — never commit real values). Full name list: [Infra §6](01_developer_guide/infra.md#6-environment-variables-names-only).

- **`backend/api_service/.env`** — `DATABASE_URL`, `REDIS_URL`, `RABBIT_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_WEBHOOK_SECRET`, `CORS_ORIGINS_URL`, `DEBUG`, `DB_AUTO_CREATE`.
- **`backend/workers/.env`** — `RABBIT_URL`, `ASM_RABBIT_JOB_QUEUE`, `DATABASE_URL`, `REDIS_URL`, `GIN_HOST`, `GIN_PORT` (8090), `X_INTERNAL_TOKEN`, `JOB_MAX_CONCURRENCY`, `TASK_TIMEOUT_SECONDS`, `ASM_ENDPOINT`.
- **`frontend/.env`** — `VITE_API_URL=http://localhost:8000`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

> The compose file provides sane local defaults (postgres/postgres, guest/guest, Redis no-password) so infra comes up even without a root `.env`. The app services still need their own `.env` files.

## 4. Path A — everything in Docker (fastest)
```bash
make up          # docker compose up -d --build  (all 8 services)
make logs        # tail everything
make down        # stop
```
Compose starts, in health-gated order: postgres → redis → rabbitmq → api → workers → reporting → frontend. Ports: frontend **:8080**, api **:8000**, postgres **:5432**, redis **:6379**, rabbitmq **:5672** (+ mgmt UI **:15672**).

## 5. Path B — hybrid (infra in Docker + apps with hot-reload)
Best for active development. Bring up only the infra, then run app services locally with reload:
```bash
docker compose up -d postgres redis rabbitmq   # just the stores
./dev.sh                                        # runs all 5 app services with prefixed logs
```
`dev.sh` starts (Ctrl+C stops all together):
- **api** — `uvicorn main:app --reload` → http://localhost:8000 (`/docs` for Swagger)
- **control-plane** — `go run ./control-plane/cmd/` → http://localhost:8090
- **consumer** — `go run ./consumer/cmd/asm/` (queue worker)
- **reporting** — `python backend/reporting/asm/main.py` (queue worker; `PYTHONPATH` is set for you)
- **frontend** — `npm run dev` → http://localhost:8080

First-time only: create the API venv and install deps, and install frontend deps:
```bash
cd backend/api_service && python3 -m venv venv && . venv/bin/activate && pip install -r requirements.txt && cd -
cd frontend && npm ci && cd -
```
Run a single service instead of the whole stack: `make run-api`, `make run-fe`, or the individual `go run` commands above.

## 6. Database migrations
Alembic owns the schema in every environment except a throwaway dev DB (`DB_AUTO_CREATE=true` will `create_all` on startup — dev only).
```bash
make migrate     # cd backend/api_service && alembic upgrade head
```
Other Alembic helpers:
```bash
make stamp       # stamp an existing DB with the baseline (no DDL) 
make backfill    # backfill org_id on legacy rows (tenancy migration)
```
Migration files live in `backend/api_service/migrations/`. See [Database Guide](05_database_guide.md).

## 7. Verify it works
```bash
curl http://localhost:8000/health     # liveness  → 200
curl http://localhost:8000/readyz     # readiness → 200 (503 if DB down)
curl http://localhost:8000/metrics    # Prometheus text
open  http://localhost:8000/docs       # Swagger UI (interactive API)
open  http://localhost:8080            # the app — sign up / log in via Supabase
open  http://localhost:15672           # RabbitMQ management (guest/guest by default)
```
`test-api.sh` at the repo root exercises the API end-to-end. On first login, JIT provisioning creates your Organization (you become `owner`) and MemberProfile automatically.

**End-to-end smoke test of a scan:** log in → Asset Inventory → add a domain you own → verify ownership → ASM → Discovery → New Discovery (Domain, Normal, Quick) → Run. Watch the LiveScanPopup, then check ASM → Findings. (Real scans need the scan CLIs installed and the control-plane running.)

## 8. Running tests
```bash
make test            # backend pytest + go test
make test-backend    # cd backend/api_service && pytest   (pure-logic, no DB required)
make go-test         # cd backend/workers && go test ./...
make lint-backend    # ruff check .
make fe-lint         # frontend eslint
# frontend type check (this is the blocking CI gate):
cd frontend && npx tsc --noEmit
```
The frontend has **no test suite** — `tsc --noEmit` + build is its correctness gate.

## 9. Common issues & fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `RuntimeError: DATABASE_URL not set` at API start | missing/empty `backend/api_service/.env` | create it (step 3) |
| API returns 500 on every request in prod-like mode | `CORS_ORIGINS` empty with `DEBUG=false` | set `CORS_ORIGINS_URL` or `DEBUG=true` locally |
| 401 loops in the UI | bad `VITE_SUPABASE_*` or `SUPABASE_JWT_SECRET` mismatch | ensure frontend and api point at the *same* Supabase project |
| Port already in use (5432/6379/8000/8080) | another local Postgres/service | stop it or remap the port in compose |
| Control-plane logs "internal token unset", binds 127.0.0.1 | `X_INTERNAL_TOKEN` missing | set it in `backend/workers/.env` (must match what the API sends) |
| RabbitMQ `PRECONDITION_FAILED` on queue declare | old `jobs.asm`/`report.asm` queues declared without DLQ args | delete the old queues in the mgmt UI and restart |
| Scans stay `PENDING`/never run | consumer or control-plane not running, or scan CLIs missing | run both Go services; install nmap/nuclei/etc. |
| Reporting import errors | `PYTHONPATH` not set | use `dev.sh` (sets it) or export `PYTHONPATH=.:backend:backend/api_service` |
| Geo Map blank | offline / CDN blocked | it fetches topojson from jsdelivr at runtime ([known limitation](01_developer_guide/frontend.md#11-known-limitations--tech-debt)) |

## 10. Verification checklist
- [ ] `docker compose ps` shows postgres/redis/rabbitmq healthy
- [ ] `curl :8000/health` → 200 and `:8000/readyz` → 200
- [ ] `:8000/docs` renders Swagger
- [ ] `:8080` loads and you can sign up / log in
- [ ] `alembic upgrade head` ran clean (or `DB_AUTO_CREATE=true` in dev)
- [ ] A test discovery runs and appears in ASM → Findings (with scan CLIs installed)
- [ ] `make test` passes

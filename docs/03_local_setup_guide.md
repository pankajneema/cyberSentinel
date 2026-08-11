# Local Development Setup Guide

> Get the entire CyberSentinel stack running locally from scratch. Two paths: **all-in-Docker** (fastest) or **hybrid** (infra in Docker, app services with hot-reload via `scripts/dev.sh`).

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
| Go | 1.24 | worker |
| Node.js | 20 | frontend |

No external identity provider needed — the API is self-hosted auth (bcrypt-hashed passwords + self-issued JWTs). You just need a `JWT_SECRET` (any random string; see §3).

Scanning tools (only needed if you run the Go worker and want real scans), by discovery intensity:
- **LIGHT**: `subfinder`, `dnsx`, `httpx`, `httprobe`
- **MEDIUM** (adds to LIGHT): `amass`, `asnmap`, `top_ports_scanner`, `service_detector`, `ssl_analyzer`, `api_detector`
- **HIGH/DEEP** (adds to MEDIUM): `bbot`, `dnsgen`, `nuclei`, `cloud_osint`, `admin_finder`, `backup_detector`, `asset_diff_engine`

## 2. Clone & orient
```bash
git clone <repo-url> cyberSentinel && cd cyberSentinel
```
Orientation (see [Inventory §2](00_inventory.md#2-top-level-services--directories)): `frontend/`, `backend/api_service/`, `worker/` (single Go binary — ASM+VS+CA), `backend/reporting/`, `backend/notificationservice/`, `infrastructure/`, `docker-compose.yml`, `scripts/dev.sh`, `Makefile`.

## 3. Environment files
Create these from their `.env.example` siblings (names only shown here — never commit real values). Full name list: [Infra §6](01_developer_guide/infra.md#6-environment-variables-names-only).

- **`backend/api_service/.env`** — `DATABASE_URL`, `REDIS_URL`, `RABBIT_URL`, `JWT_SECRET` (required — generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`), `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `OAUTH_REDIRECT_BASE_URL`, `FRONTEND_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (optional), `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (optional), `CORS_ORIGINS_URL`, `DEBUG`, `DB_AUTO_CREATE`.
- **`worker/.env`** — `RABBIT_URL`, `DATABASE_URL`, `REDIS_URL`, `X_INTERNAL_TOKEN` (must match the API's `CONTROL_PLANE_TOKEN`), `JOB_MAX_CONCURRENCY`, `TASK_TIMEOUT_SECONDS`.
- **`frontend/.env`** — `VITE_API_URL=http://localhost:8000`. Nothing else — the SPA only talks to our own API, no separate identity-provider config.

> The compose file provides sane local defaults (postgres/postgres, guest/guest, Redis no-password) so infra comes up even without a root `.env`. The app services still need their own `.env` files, and `JWT_SECRET` in particular has no default — the API fails fast without it.

## 4. Path A — everything in Docker (fastest)
```bash
make up          # docker compose up -d --build  (all services)
make logs        # tail everything
make down        # stop
```
Compose starts, in health-gated order: postgres → redis → rabbitmq → api → worker → reporting → frontend. Ports: frontend **:8080**, api **:8000**, postgres **:5432**, redis **:6379**, rabbitmq **:5672** (+ mgmt UI **:15672**).

## 5. Path B — hybrid (infra in Docker + apps with hot-reload)
Best for active development. Bring up only the infra, then run app services locally with reload:
```bash
docker compose up -d postgres redis rabbitmq   # just the stores
./scripts/dev.sh                                        # runs all app services with prefixed logs
```
`scripts/dev.sh` starts (Ctrl+C stops all together):
- **api** — `uvicorn main:app --reload` → http://localhost:8000 (`/docs` for Swagger)
- **consumer** — `cd worker && go run .` (single Go binary; consumes `asm.*`/`vs.*`/`ca.*` priority queues in-process — there is no separate control-plane binary or port)
- **rpt-asm**, **rpt-vs**, **rpt-ca** — three separate reporting consumers (`python -m backend.reporting.asm` / `.vs` / `.ca`; `PYTHONPATH` is set for you)
- **frontend** — `npm run dev` → http://localhost:8080

First-time only: create the API venv and install deps, and install frontend deps:
```bash
cd backend/api_service && python3 -m venv .venv-run && . .venv-run/bin/activate && pip install -r requirements.txt && cd -
cd frontend && npm ci && cd -
```
Run a single service instead of the whole stack: `make run-api`, `make run-fe`, or `cd worker && go run .` for the worker.

## 6. Database migrations
Alembic owns the schema in every environment except a throwaway dev DB (`DB_AUTO_CREATE=true` will `create_all` on startup — dev only).
```bash
make migrate     # cd backend/api_service && alembic upgrade head
```
Other Alembic helpers:
```bash
make stamp       # stamp an existing DB with the baseline (no DDL)
make backfill    # backfill org_id on existing rows (tenancy migration)
```
Migration files live in `backend/api_service/migrations/`. See [Database Guide](05_database_guide.md).

## 7. Verify it works
```bash
curl http://localhost:8000/health     # liveness  → 200
curl http://localhost:8000/readyz     # readiness → 200 (503 if DB down)
curl http://localhost:8000/metrics    # Prometheus text
open  http://localhost:8000/docs       # Swagger UI (interactive API)
open  http://localhost:8080            # the app — sign up / log in
open  http://localhost:15672           # RabbitMQ management (guest/guest by default)
```
`scripts/test-api.sh` at the repo root exercises the API end-to-end. On first login (signup, or first OAuth login), JIT provisioning creates your Organization (you become `owner`) and MemberProfile automatically.

**End-to-end smoke test of a scan:** sign up → Asset Inventory → add a domain you own → ASM → Discovery → New Discovery (Domain, Light, Quick — Light needs no ownership verification) → Create Discovery. Watch it move Pending → Running in the Discovery tab, then check ASM → Findings. (Real scans need the scan CLIs installed and the Go worker running — see §1.) Normal/Deep discoveries require verifying domain ownership first (DNS TXT record challenge, shown on the asset row).

## 8. Running tests
```bash
make test            # backend pytest + go test
make test-backend    # cd backend/api_service && pytest   (needs pytest + pytest-asyncio installed in the venv)
make go-test         # cd worker && go test ./...
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
| `RuntimeError: JWT_SECRET is not set` at API start | missing/empty `JWT_SECRET` | generate one (step 3) — there is no fallback default, by design |
| API returns 500 on every request in prod-like mode | `CORS_ORIGINS` empty with `DEBUG=false` | set `CORS_ORIGINS_URL` or `DEBUG=true` locally |
| 401 loops in the UI | expired/invalid access token with no refresh token in storage | log out and log back in; check the browser's localStorage/sessionStorage for `cs.auth.tokens` |
| Google/GitHub button returns a JSON 503 | `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` not configured | expected until you register OAuth apps and set the client id/secret — email/password still works |
| Port already in use (5432/6379/8000/8080) | another local Postgres/service | stop it or remap the port in compose |
| Worker logs "internal token unset" or scans never dispatch | `X_INTERNAL_TOKEN` in `worker/.env` doesn't match `CONTROL_PLANE_TOKEN` in the API's `.env` | make the two match |
| RabbitMQ `PRECONDITION_FAILED` on queue declare | old queues declared without current args | delete the old queues in the mgmt UI and restart |
| Scans stay `PENDING`/never run | worker not running, or scan CLIs missing | run the worker (`cd worker && go run .`); install the tools listed in §1 |
| Reporting import errors | `PYTHONPATH` not set | use `scripts/dev.sh` (sets it) or export `PYTHONPATH=.:backend:backend/api_service` |
| Geo Map blank | offline / CDN blocked | it fetches topojson from jsdelivr at runtime ([known limitation](01_developer_guide/frontend.md#11-known-limitations--tech-debt)) |

## 10. Verification checklist
- [ ] `docker compose ps` shows postgres/redis/rabbitmq healthy
- [ ] `curl :8000/health` → 200 and `:8000/readyz` → 200
- [ ] `:8000/docs` renders Swagger
- [ ] `:8080` loads and you can sign up / log in
- [ ] `alembic upgrade head` ran clean (or `DB_AUTO_CREATE=true` in dev)
- [ ] A test discovery runs and appears in ASM → Findings (with scan CLIs installed)
- [ ] `make test` passes

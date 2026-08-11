# Run All Services — One by One

A manual, service-by-service guide to boot the **entire CyberSentinel stack**. Open **one terminal tab per service** and run them in this order. (Prefer a single command? Use `./scripts/dev.sh`.)

Order matters: **infra first**, then the API, then the worker, then reporting, then the frontend.

| # | Service | Terminal | Port |
|---|---|---|---|
| 0 | Infra (Postgres · Redis · RabbitMQ) | 1 | 5432 / 6379 / 5672 |
| 1 | API service (FastAPI) | 2 | 8000 |
| 2 | Go worker (unified — consumes asm.*/vs.*/ca.* queues) | 3 | — |
| 3 | Reporting consumer — ASM (Python) | 4 | — |
| 4 | Reporting consumer — VS (Python) | 5 | — |
| 5 | Reporting consumer — CA (Python) | 6 | — |
| 6 | Frontend (React / Vite) | 7 | 8080 |

There is **one** Go binary (`worker/`) — it consumes ASM, VS, and CA priority queues in-process. There is no separate "control-plane" binary and nothing runs on port 8090.

---

## One-time setup (do this first, once)

```bash
# from the repo root: /Users/mac/pnkj/cyberSentinel

# Python venv for the API + reporting (name doesn't matter — dev.sh prefers .venv-run,
# falling back to venv/ if that's not present; use whichever you create)
cd backend/api_service
python3 -m venv .venv-run
source .venv-run/bin/activate
pip install -r requirements.txt
deactivate
cd ../..

# Frontend deps
cd frontend
npm ci
cd ..
```

Also create the three `.env` files (see [docs/03_local_setup_guide.md](docs/03_local_setup_guide.md#3-environment-files) for the full variable list):
- `backend/api_service/.env`
- `worker/.env`
- `frontend/.env`

---

## 0. Infra — Postgres, Redis, RabbitMQ  *(Terminal 1)*

```bash
docker compose up -d postgres redis rabbitmq

# wait until all three are healthy:
docker compose ps
```
- Postgres → `localhost:5432`
- Redis → `localhost:6379`
- RabbitMQ → `localhost:5672` (management UI: http://localhost:15672, `guest`/`guest`)

**Run migrations once** (creates all tables):
```bash
cd backend/api_service
source .venv-run/bin/activate
alembic upgrade head
deactivate
cd ../..
```

---

## 1. API service — FastAPI  *(Terminal 2)*

The control plane: auth (self-hosted — see below), tenancy, CRUD, dispatches scan jobs.

```bash
cd backend/api_service
source .venv-run/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- API → http://localhost:8000
- Swagger docs → http://localhost:8000/docs
- Health check → http://localhost:8000/health

We are the identity provider — no external auth service to configure. `backend/api_service/.env` needs a real `JWT_SECRET` (generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`) or the API refuses to boot. Google/GitHub OAuth are optional; leaving `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` unset just makes `/api/v1/auth/oauth/{provider}` return a clean 503 instead of a working redirect — email/password auth works regardless.

---

## 2. Go worker — unified consumer  *(Terminal 3)*

The orchestrator + executor: pulls scan jobs off RabbitMQ (`asm.high`/`asm.low`/`asm.medium`, plus the `vs.*`/`ca.*` equivalents) and runs the scan tools directly, in-process.

```bash
cd worker
go run .
```
- No port — it's a background queue worker. Watch its logs for job pickups (`"running subfinder for ..."`, etc).

Needs the scan CLIs on `PATH` for real scans, by discovery intensity:
- **LIGHT**: `subfinder`, `dnsx`, `httpx`, `httprobe`
- **MEDIUM** (adds to LIGHT): `amass`, `asnmap`, `top_ports_scanner`, `service_detector`, `ssl_analyzer`, `api_detector`
- **HIGH/DEEP** (adds to MEDIUM): `bbot`, `dnsgen`, `nuclei`, `cloud_osint`, `admin_finder`, `backup_detector`, `asset_diff_engine`

The worker logs which tools it found on startup (`=== Verifying LIGHT/MEDIUM/HIGH intensity tools ===`) — check there first if a discovery of a given intensity won't run.

---

## 3–5. Reporting consumers — Python  *(Terminals 4–6)*

Three separate consumers, one per module, each consuming its own queue and writing findings into PostgreSQL:

```bash
# from the repo root, same venv as the API service
PYTHONPATH="$PWD:$PWD/backend:$PWD/backend/api_service" \
  backend/api_service/.venv-run/bin/python -m backend.reporting.asm   # reporting.asm  -> ASM findings

PYTHONPATH="$PWD:$PWD/backend:$PWD/backend/api_service" \
  backend/api_service/.venv-run/bin/python -m backend.reporting.vs    # reporting.vs   -> VS findings

PYTHONPATH="$PWD:$PWD/backend:$PWD/backend/api_service" \
  backend/api_service/.venv-run/bin/python -m backend.reporting.ca    # reporting.ca   -> CA findings
```
No ports — background queue workers. The `PYTHONPATH` is required so both `backend.*` and `config.*`/`utils.*`-style imports resolve; `-m backend.reporting.<module>` (not a direct script path) matches how the module is actually invoked (see `scripts/dev.sh`).

---

## 6. Frontend — React / Vite  *(Terminal 7)*

```bash
cd frontend
npm run dev
```
- App → http://localhost:8080

`frontend/.env` only needs `VITE_API_URL=http://localhost:8000` — there's no separate identity-provider config on the frontend either; the SPA talks only to our own API.

---

## Quick verification

```bash
curl http://localhost:8000/health     # → 200
curl http://localhost:8000/readyz      # → 200 (503 if DB down)
open  http://localhost:8080            # sign up / log in
```

End-to-end test: sign up → **Asset Inventory** add a domain → **ASM → Discovery → New Discovery** (Domain, Light or Normal, Quick) → **Create Discovery** → watch it move from Pending → Running in the Discovery tab → check **ASM → Findings**. A Light scan needs no ownership verification; Normal/Deep (active) scans do — see the "Verify" flow on the asset row.

---

## Stop everything

- App services: press **Ctrl+C** in each terminal (2–7).
- Infra: `docker compose down` (add `-v` to also wipe the Postgres volume).

## Startup order — why

```
Infra (DB/Redis/Rabbit)  →  API  →  worker  →  reporting (asm/vs/ca)  →  frontend
```
The stores must be up before anything connects; the API creates the job records and queues; the Go worker executes scans; the three reporting consumers persist results; the frontend just needs the API. If the worker starts before RabbitMQ is healthy it will retry/exit — start infra first.

See also: [docs/03_local_setup_guide.md](docs/03_local_setup_guide.md) · [docs/01_developer_guide/overview.md](docs/01_developer_guide/overview.md)

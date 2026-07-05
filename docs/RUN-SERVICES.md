# Run All Services — One by One

A manual, service-by-service guide to boot the **entire CyberSentinel stack**. Open **one terminal tab per service** and run them in this order. (Prefer a single command? Use `./scripts/start.sh`.)

Order matters: **infra first**, then the API, then the workers, then the frontend.

| # | Service | Terminal | Port |
|---|---|---|---|
| 0 | Infra (Postgres · Redis · RabbitMQ) | 1 | 5432 / 6379 / 5672 |
| 1 | API service (FastAPI) | 2 | 8000 |
| 2 | Go ASM worker (control-plane) | 3 | 8090 |
| 3 | ASM consumer (Go queue worker) | 4 | — |
| 4 | Report consumer (Python) | 5 | — |
| 5 | Frontend (React / Vite) | 6 | 8080 |

---

## One-time setup (do this first, once)

```bash
# from the repo root: /Users/mac/pnkj/cyberSentinel

# Python venv for the API + reporting
cd backend/api_service
python3 -m venv venv
source venv/bin/activate
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
- `backend/workers/.env`
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
source venv/bin/activate
alembic upgrade head
deactivate
cd ../..
```

---

## 1. API service — FastAPI  *(Terminal 2)*

The control plane: auth, tenancy, CRUD, dispatches scan jobs.

```bash
cd backend/api_service
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- API → http://localhost:8000
- Swagger docs → http://localhost:8000/docs
- Health check → http://localhost:8000/health

---

## 2. Go ASM worker — control-plane  *(Terminal 3)*

The orchestrator + executor: builds the scan pipeline and runs the scan tools.

```bash
cd backend/workers
go run ./control-plane/cmd/
```
- Internal API → http://localhost:8090

> Needs the scan CLIs on `PATH` for real scans: `nmap`, `naabu`, `nuclei`, `subfinder`, `gitleaks`.

---

## 3. ASM consumer — Go queue worker  *(Terminal 4)*

Pulls scan jobs off RabbitMQ (`jobs.asm`) and forwards them to the control-plane.

```bash
cd backend/workers
go run ./consumer/cmd/asm/
```
- No port — it's a background queue worker. Watch its logs for job pickups.

---

## 4. Report consumer — Python  *(Terminal 5)*

Consumes scan results (`report.asm`) and writes findings into PostgreSQL.

```bash
# from the repo root
PYTHONPATH="$PWD:$PWD/backend:$PWD/backend/api_service" \
  backend/api_service/venv/bin/python backend/reporting/asm/main.py
```
- No port — background queue worker. The `PYTHONPATH` line is required so its imports resolve.

---

## 5. Frontend — React / Vite  *(Terminal 6)*

```bash
cd frontend
npm run dev
```
- App → http://localhost:8080

---

## Quick verification

```bash
curl http://localhost:8000/health     # → 200
curl http://localhost:8000/readyz      # → 200 (503 if DB down)
open  http://localhost:8080            # sign up / log in
```

End-to-end test: log in → **Asset Inventory** add a domain → **ASM → Discovery → New Discovery** (Domain, Normal, Quick) → **Run** → watch the live popup → check **ASM → Findings**.

---

## Stop everything

- App services: press **Ctrl+C** in each terminal (2–6).
- Infra: `docker compose down` (add `-v` to also wipe the Postgres volume).

## Startup order — why

```
Infra (DB/Redis/Rabbit)  →  API  →  control-plane  →  consumer  →  reporting  →  frontend
```
The stores must be up before anything connects; the API creates the job records and queues; the two Go workers execute scans; reporting persists results; the frontend just needs the API. If a worker starts before RabbitMQ is healthy it will retry/exit — start infra first.

See also: [docs/03_local_setup_guide.md](docs/03_local_setup_guide.md) · [docs/01_developer_guide/overview.md](docs/01_developer_guide/overview.md)

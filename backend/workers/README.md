# Background Workers

Background services responsible for long‑running or heavy jobs. They are **separate from the API service**, but integrate with it via queues and HTTP.

There are currently two implementations:

- **Python workers** – original prototypes (`asm_worker.py`, `vs_worker.py`).
- **Go workers** – new, structured skeletons under `go/` for ASM and VS flows.

---

## Python workers (legacy prototypes)

Files:

- `asm_worker.py`
- `vs_worker.py`

High‑level responsibilities:

- Process ASM discovery / VS scan jobs from a queue.
- Run actual scanners (DNS/ports/services, nmap, trivy, etc.).
- Persist results into the database.

These scripts are **standalone** and currently not wired to the new API contracts.

Run manually:

```bash
cd backend/workers
python3 asm_worker.py   # ASM discovery prototype
python3 vs_worker.py    # Vulnerability scanning prototype
```

---

## Go workers (current skeletons)

Located in `backend/workers/go`. They are structured as separate commands under `cmd/`:

```text
go/
  go.mod
  cmd/
    asm_discovery/       # ASM discovery worker
    asm_exposure/        # ASM exposure analysis worker
    vs_scan_trigger/     # VS scan trigger worker
    vs_result_fetcher/   # VS result fetcher worker
    vs_normalization/    # VS normalization worker
```

Each command is a **small, independent binary** with:

- Environment‑driven configuration (API base URL, queue URLs).
- Structured logging to stdout.
- Placeholder loops and TODOs instead of real scanning logic.

### Responsibilities (skeleton only)

- **`asm_discovery`**
  - Reads discovery jobs from a queue.
  - Calls legacy ASM API `POST /api/v1/asm/discover`.
  - Emits job status back to the platform.

- **`asm_exposure`**
  - Periodically reads assets from `/api/v1/asm/assets` and `/api/v1/assets`.
  - Computes exposure signals (public/internal, tags).
  - PATCHes `/api/v1/assets/{id}` with updated metadata.

- **`vs_scan_trigger`**
  - Dequeues scheduled/on‑demand VS scan jobs.
  - Triggers scans via `POST /api/v1/scans`.

- **`vs_result_fetcher`**
  - Polls `GET /api/v1/scans/{id}` for scan status/results.
  - Pushes raw findings to a normalization queue.

- **`vs_normalization`**
  - Consumes raw results from the normalization queue.
  - Normalizes into the platform‑wide VS finding schema.
  - Will call future `/api/v1/vs/findings` endpoints to persist.

### Building and running Go workers

From `backend/workers/go`:

```bash
# Build all commands
go build ./cmd/...

# Run a single worker (examples)
API_BASE_URL=http://localhost:8000/api/v1 \
QUEUE_URL=redis://localhost:6379/0 \
go run ./cmd/asm_discovery

API_BASE_URL=http://localhost:8000/api/v1 \
go run ./cmd/asm_exposure

API_BASE_URL=http://localhost:8000/api/v1 \
QUEUE_URL=redis://localhost:6379/0 \
go run ./cmd/vs_scan_trigger

API_BASE_URL=http://localhost:8000/api/v1 \
NORMALIZATION_QUEUE_URL=redis://localhost:6379/1 \
go run ./cmd/vs_result_fetcher

API_BASE_URL=http://localhost:8000/api/v1 \
NORMALIZATION_QUEUE_URL=redis://localhost:6379/1 \
go run ./cmd/vs_normalization
```

These workers are **intentionally skeleton‑only**:

- No real scanning logic is implemented.
- Safe to compile and run in development.
- All real scanner integrations should be added incrementally, keeping the HTTP/API contracts stable.

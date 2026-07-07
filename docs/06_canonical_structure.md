# Canonical Module Structure

**One skeleton, three organs.** ASM, VS, and CA implement different domains, but every layer of every
module follows the same layout, layering rules, and naming. A developer who knows one module knows all three.

This structure was **derived from the codebase**, not imposed: CA (the newest module) already has the
cleanest backend shape (thin routes + a real domain package + data-driven seed catalogs), VS has the
cleanest worker/reporting shape (typed queue contracts, adapter registry, pure report builder), and
`routes/assets.py` documents the reference tenancy pattern. The canon below is those strongest existing
patterns, applied uniformly.

---

## 1. Backend (`backend/api_service/`) — per-module skeleton

```
api_service/
├── routes/<module>.py          # HTTP layer ONLY: auth deps, validation, pagination dep,
│                               # ownership guard, calls into <module>/service.py
├── <module>/                   # Domain package (asm/, vs/, ca/)
│   ├── __init__.py
│   ├── service.py              # Business logic: orchestration, queue-publish envelope,
│   │                           # scheduler tick for this module
│   └── ...                     # Module-specific engines allowed (ca/engine.py,
│                               # ca/checks_registry.py) — internal detail of the package
├── models/<module>_models.py   # SQLAlchemy ORM models (Asm*/Vs*/Ca* prefixes)
├── schemas/<module>_schema.py  # Pydantic request/response schemas
└── scoring/                    # Pure, side-effect-free scoring functions
```

### Layering rules
1. **Routes** never build multi-step business flows or publish to queues directly; they authenticate,
   validate, scope to the org, and call the module's service.
2. **Domain packages** (`asm/`, `vs/`, `ca/`) hold business logic and are the ONLY place a module's
   queue messages are built (`<module>/service.py: enqueue_*`). They never import from `routes/`.
3. **`utils/` is shared infrastructure only** — nothing module-specific lives there. `utils/` never
   imports from `routes/` (the old `scheduler.py → routes.assets` inversion is fixed).
4. **Scheduler** (`utils/scheduler.py`) is a thin loop that calls each module's tick function
   (`asm.service.tick_due_discoveries`, `vs.service.tick_due_scans`, …). Locking semantics
   (`FOR UPDATE SKIP LOCKED`) live with the tick, unchanged.
5. **`scoring/`** stays pure: no DB, no HTTP, no queue.

### Shared code (used identically by all three modules)
| Concern | One home | Replaces |
|---|---|---|
| Auth | `utils/supabase_auth.py` → `CurrentUser`, `require_role(...)` | legacy `utils/auth_utils.py` dict user, ASM `_require_write_access` |
| Tenancy | `utils/tenancy.py` → `require_org(user.org_id)` + explicit `Model.org_id ==` filter | ASM `_org_filter`/`_company_user_ids` |
| Pagination | `utils/pagination.py` → `PageParams` dependency + `{items,total,page,page_size}` envelope | per-endpoint hand-rolled page/clamp code |
| Ownership guard | `utils/ownership.py` → `get_owned_or_404(db, Model, id, org_id)` | 7 private `_owned_*` copies |
| Lifecycle transitions | `utils/lifecycle.py` → transition-map validator + history-row writer | VS `_TRANSITIONS` + CA `_GAP_TRANSITIONS` clones |
| Queue publish | `utils/queue.py` (unchanged contract) — called only from `<module>/service.py` | envelope dicts duplicated in routes + scheduler |
| Email | `backend/notificationservice/email.py` via `dispatcher.py` | `utils/emailer.py` near-duplicate |
| SLA constants | `utils/constants.py` `SLA_DAYS` | duplicated in `ca/engine.py` and `reporting/vs/ingest.py` |

### Naming conventions
| Concern | Canon |
|---|---|
| DB tables | `<module>_snake_case` (`asm_discoveries`, `vs_scans`, `ca_controls`) |
| ORM models | `Asm*` / `Vs*` / `Ca*` PascalCase in `models/<module>_models.py` |
| Routes | `routes/<module>.py`, prefix `/api/v1/<module>`; worker-only endpoints under `/api/v1/internal/<module>` |
| Queues | `jobs.<module>` (work in), `report.<module>` (results out) — string literals must match Go `config/config.go` defaults and the DLX declaration must byte-match across languages |
| Machine statuses | UPPERCASE (`PENDING/RUNNING/COMPLETED/FAILED`) |
| Human workflow statuses | lowercase (`open/confirmed/remediated`, `satisfied/partial/gap`) |
| Error responses | `HTTPException(status, detail)` — sentence-case detail; cross-tenant misses are **404, never 403** |
| API JSON | snake_case (reports module's camelCase is a known legacy exception, see §5) |

## 2. Go workers (`backend/workers/`)

```
workers/
├── consumer/
│   ├── cmd/main.go             # single binary, consumes jobs.asm + jobs.vs
│   ├── start.go                # bounded worker pool, ack-after-success, nack→DLQ (the canon)
│   ├── dispatcher.go           # routes on msg.type
│   └── <module>/job.go         # one HandleJob(body []byte) error per module; typed
│                               # jobMsg/reportMsg structs (contract with Python)
├── executor/
│   ├── <module>/               # per-module engine, ONE flat Go package each:
│   │                           # asm/ (job lifecycle + pipeline + tool-running task.go),
│   │                           # vs/ (Scanner adapters, panic recovery, per-target timeout)
│   └── tools/                  # SHARED tool wrappers (nmap, nuclei, sslscan, …) — used by
│                               # both the ASM engine and VS adapters; never module-specific
├── config/config.go            # env-driven, defaulted queue names
└── database/                   # postgres/redis clients
```

- **One uniform execution path for both modules:** `consumer/<module>/job.go` `HandleJob` runs the
  scan IN-PROCESS (ASM via `executor/asm` orchestration+runner, VS via `executor/vs` adapters) and
  publishes `report.<module>`. Single `consumer` binary, ACK-after-success. There is no longer any
  ASM-only control-plane hop — ASM and VS have the identical folder shape and the identical flow.
- **CA has no worker tier by design** — it scans nothing; it evaluates evidence already in Postgres
  (triggered via the API and reporting's `ca_hook.py`). No `jobs.ca` queue, no `consumer/ca`, no `executor/ca`.
- ASM still mirrors pipeline state to Redis (`asm:pipeline:{job_id}`, consumed by reporting) — that
  contract is unchanged; only the HTTP hop between consumer and pipeline was removed.
- Never log raw queue message bodies (may contain targets/credential ids).

## 3. Reporting (`backend/reporting/`) — a Python queue-consumer, not an HTTP service

```
reporting/
├── <module>/                   # asm/, vs/
│   ├── consumer/entrypoint     # consumes report.<module>
│   ├── ingest logic            # DB persistence (vs/ingest.py is the canon: typed, idempotent)
│   └── report_builder          # pure summary builder
├── ca_hook.py                  # best-effort CA re-evaluation after VS ingest
└── sanitize.py                 # THE ONLY sanitization path (clean_str/clean_deep)
```

- Imports `api_service` models via `backend.api_service.*` (PYTHONPATH pinned in Dockerfile) —
  **api_service module paths are load-bearing for this service and for `ca_hook.py`'s
  `sys.modules` aliasing; do not rename/move `models/`, `ca/`, `utils/database` paths.**

## 4. Frontend (`frontend/src/`) — per-module skeleton

```
src/
├── lib/api.ts                  # single apiFetch (bearer, 401 signout, 403 friendly,
│                               # blob/download mode) + buildQuery + Paginated<T>
├── lib/services/<module>.ts    # thin typed fetchers only — no fetch() anywhere else
├── lib/permissions.ts          # role→capability matrix
├── hooks/useMe.tsx             # one profile/RBAC hook (replaces per-page getMe copies)
├── components/shared/          # StatusBadge (single STATUS_META registry), csv export
├── components/<module>/        # PascalCase.tsx, export name == file name;
│                               # CA idiom is the canon: shadcn Table, cancelled-flag
│                               # effects, reload counters, Sheet detail, AlertDialog
│                               # for destructive actions, debounced search
└── pages/app/<Module>.tsx      # tab container mounting the module's components
```

## 5. Deliberate non-changes (behavior preservation)

These were identified as drift but are **contracts** whose change would alter behavior; they are
documented instead of "fixed":

- Queue names, message envelope fields, and DLX arguments (cross-language string contracts).
- ASM's member-id tenancy filter semantics (documented leak rationale in the code) — the auth
  *dependency* is unified, the *filter semantics* are unchanged.
- Reports API camelCase JSON (coupled to `reports.ts`) — coordinated break, deferred.
- ASM enum casing in DB values (`LIGHT/NORMAL/DEEP`) — stored data + Go contract.
- Naive-UTC datetimes — stored data comparisons; CA normalizes via `_naive_utc`.
- Alembic revision ids and the `cybersentinel.ca_allow_delete` GUC trigger contract.

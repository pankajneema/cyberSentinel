# Worker Task Flow — how a scan job travels UI → API → worker → reporting → DB

This documents the end-to-end lifecycle of a scan job, with the exact data at
each hop. **ASM is the reference flow**; VS follows the same shape with one
difference (noted at the end). Every claim below is grounded in code.

```
   UI                API (FastAPI)            WORKER (Go, one binary)          REPORTING (py)          DB
   │  start scan       │                          │                                │
   ├──────────────────►│  persist asm_discoveries │                                │
   │                   ├──── jobs.asm (RabbitMQ) ─►│ consume + dispatch by "type"   │
   │                   │                          │ RegisterJob:                    │
   │                   │                          │  • read discovery row (PG)      │
   │                   │                          │  • GeneratePipeline             │
   │                   │                          │  • store asm:pipeline:{id}(Redis)│
   │                   │                          │  • status=RUNNING (PG)          │
   │                   │                          │ ExecuteJob → run stages in order:│
   │                   │                          │  for each stage:                │
   │                   │                          │   • run tool                    │
   │                   │                          │   • update asm:pipeline:{id}     │
   │                   │                          │   ├── report.asm: step event ───►│ read asm:pipeline:{id}
   │                   │                          │   │                              │ → store step result (PG)
   │                   │                          │  on finish:                     │
   │                   │                          │   ├── report.asm: FINAL event ──►│ read full pipeline
   │                   │                          │   │                              │ → persist scan result (PG)
   │                   │                          │   • status=COMPLETED (PG)       │
   │◄── websocket ─────┤◄── asm:worker:events ────┤   • lifecycle event (Redis)     │
   │  (realtime UI)    │     (Redis pub/sub)      │ return nil ⇒ consumer ACKs      │
```

## 1. UI → API

The user triggers a discovery. The API persists a row in Postgres
`asm_discoveries`, then builds the queue envelope in the ONE canonical place —
`backend/api_service/asm/service.py::build_job_message` — and publishes it to the
RabbitMQ queue `jobs.asm`:

```json
{ "type": "asm", "user_id": "…", "id": "<discovery_id>",
  "asset_type": "domain", "target_source": "…", "intensity": "DEEP" }
```

This field set is a **cross-language contract** with the Go worker
(`backend/workers/services/asm/consumer.go`).

## 2. Queue → Worker (dispatch)

The single worker binary (`backend/workers/main.go`) consumes both `jobs.asm`
and `jobs.vs` through one bounded worker pool (`utils.StartConsumer`, folded from
the old `consumer/start.go`). `utils.Dispatch` reads the message `type` and
routes it to the handler each service registered via `module.Register()`:

- `asm.Register()` → `type:"asm"` → `services/asm.HandleJob`
- `vs.Register()`  → `type:"vs"`  → `services/vs.HandleJob`

The dispatcher never imports service internals — it only knows the registry.

## 3. Register (build the pipeline) — `services/asm/orchestrator.go::RegisterJob`

1. Ensure Postgres + Redis connections.
2. Fetch the full discovery row: `repository.go::DiscoveryJSON` →
   `SELECT row_to_json(ad) FROM asm_discoveries WHERE id = $1`.
3. **Idempotency guard**: if the discovery is already `COMPLETED`, or `RUNNING`
   within the reaper window (`TASK_TIMEOUT_SECONDS`), return
   `ErrAlreadyProcessed` → the consumer ACKs without re-running (no duplicate
   scan on redelivery).
4. `GeneratePipeline` (`pipeline.go`) expands
   `PipelineConfig[asset_type][intensity]` (`pipeline_config.go`) into an ordered
   list of stages, each mapped to a tool, all status `PENDING`.
5. **Store the pipeline JSON in Redis key `asm:pipeline:{id}`** (TTL 24h). This
   key is the shared state that carries each stage's result payload.
6. Set Postgres status `RUNNING` (`repository.go::SetDiscoveryRunning`).

## 4. Execute (run stages, emit events) — `services/asm/executor.go::Run`

Called by `ExecuteJob`, bounded by `TASK_TIMEOUT_SECONDS`. It walks the pipeline
**in order**; a switch on the stage name dispatches to the tool:

| stage (examples)        | tool                                            |
|-------------------------|-------------------------------------------------|
| `subdomain_discovery`   | `subfinder`                                     |
| `cert_intel`            | `crtsh`                                          |
| `ai_subdomain_probe`    | `tools/ai/subdomainprobe` (DNS AI-subdomain probe) |
| `dns_resolution`        | `dnsx`                                           |
| `http_status`           | `httpx`                                          |
| `service_fingerprint`   | `nmap`                                           |
| `vulnerability_scan`    | `nuclei`                                         |

After **each** stage it:
- writes the stage's `status` + `result` back into `asm:pipeline:{id}`
  (`SavePipelineRaw`), and
- emits a **step event** to `report.asm`
  (`emitStepEvent`): `{job_id, asset_id, stage, tool, status, progress, is_final:false}`.

Data feeds forward through the Redis pipeline document: subfinder's subdomains →
dnsx → httpx; resolved IPs → nmap; and so on.

When all stages finish it:
- emits **one FINAL event** to `report.asm` (`emitFinalEvent`):
  `{job_id, status:"PIPELINE_COMPLETED", progress:100, is_final:true}`,
- sets Postgres `COMPLETED` (`SetDiscoveryCompleted`, using a fresh short-lived
  context so the write always lands even if a tool consumed the whole timeout),
- fires a lifecycle event on the Redis pub/sub channel `asm:worker:events`
  (`publishScanEvent`, fire-and-forget).

`HandleJob` returns nil only now ⇒ the RabbitMQ consumer **ACKs**
(ACK-after-success). Any failure ⇒ `Nack(requeue=false)` ⇒ DLQ (no auto-retry;
re-run via reaper or DLQ replay).

## 5. Report consumer → DB — `backend/reporting/asm/main.py`

Consumes `report.asm`. Using the `job_id` from the event, it **reads
`asm:pipeline:{job_id}` from Redis** and persists:
- on each **step event** (status `COMPLETED`): finds that step's `result` in the
  pipeline and stores it incrementally (`store_step_data`),
- on the **FINAL event**: reads the whole pipeline and persists the complete
  scan result.

Exposure scoring is NOT done here — the API scheduler scores assets
asynchronously from the persisted rows.

## 6. Realtime back to UI

Separately, the API subscribes to the Redis `asm:worker:events` channel and
pushes lifecycle changes (completed/failed) to the UI over websocket /
notifications. The reporting service writes the rows; the API serves them back
to the UI on refresh/poll.

## The three data channels (why there are three)

| name                   | transport      | carries                                   | consumer            |
|------------------------|----------------|-------------------------------------------|---------------------|
| `report.asm`           | RabbitMQ       | step + FINAL events (thin: ids/status)    | reporting → DB      |
| `asm:worker:events`    | Redis pub/sub  | lifecycle (completed/failed)              | API → websocket/UI  |
| `asm:pipeline:{id}`    | Redis key      | the actual per-stage result payloads      | shared, both read   |

The events are deliberately thin; the heavy result data lives in the Redis
pipeline key, which the reporting consumer pulls by `job_id`.

## VS variant (one difference)

VS runs **stateless**: `services/vs/consumer.go::HandleJob` scans every target
with the enabled engine adapters and publishes **one** report message to
`report.vs` with all findings inline — no incremental `asm:pipeline`-style Redis
document and no per-step events. `services/vs/jobstore.go` is a documented
placeholder marking where that per-job Redis state would live if VS later gains
an incrementally-updated pipeline (the same Redis-key + websocket flow ASM uses).

Everything else is symmetric: VS has the same canonical files as ASM
(`module, consumer, job, jobstore, pipeline, pipeline_config, orchestrator,
executor, repository`), with its engine adapters (`*_adapter.go`) as the VS-side
flow files.

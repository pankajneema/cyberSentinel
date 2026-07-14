# 09 — Scan-Execution Redesign (ASM / VS / CA)

> Status: implemented 2026-07-09, verified end-to-end against live RabbitMQ + Redis + Postgres.
> This document supersedes the worker sections of `06_canonical_structure.md`, `07_refactor_report.md`,
> and `08_worker_task_flow.md`. Those describe the pre-redesign worker (single `jobs.asm`/`jobs.vs`
> consumer, `asm:pipeline:{id}` Redis blob, per-service report queues). The redesign replaces that spine.

## 1. What changed and why

One shared **execution engine** now serves all three services (ASM, VS, CA). A service answers only
*what stages to run* and *how to hand its findings off*; everything else — consume, admit, run loop,
Redis state, live events, cancel, reporting hand-off, crash recovery — is shared. The old worker had a
1,589-line `executor.go` switch per tool and diverged wildly between ASM (stateful) and VS (stateless).

**Fixed decisions**
- **Python (FastAPI)** owns everything user-facing: intake/trigger, scheduler/cron, task command/query
  API, live SSE, reporting persistence, notifications.
- **Go worker** does execution only: consume → admit (Redis slot) → build pipeline → run tools →
  save findings + progress → push to reporting. Stateless, horizontally scalable. No Gin, no control-plane.
- **Redis** = concurrency slots, live task/pipeline state, progress pub/sub, cancel flag, lease/heartbeat.
- **Postgres** = durable run state + findings. Findings are persisted by the Python reporting consumer
  (the worker ships them per-stage), so the UI Findings tab is live.
- **RabbitMQ** = per-service, per-priority job queues + per-service reporting queues.

## 2. Locked cross-language contracts

These MUST match byte-for-byte between the Go worker (`worker/core/contract.go`) and Python
(`backend/api_service/utils/scan_contracts.py`). Change both together.

**Queues** (RabbitMQ): `asm.high asm.medium asm.low  vs.high vs.medium vs.low  ca.high ca.medium ca.low`,
plus per-service reporting queues `reporting.asm reporting.vs reporting.ca` (so each reporting consumer runs
independently). Each queue carries the dead-letter topology below.

**DLX / DLQ** (unchanged from the pre-redesign convention — reused deliberately): per queue `<q>`, a
durable **fanout exchange `<q>.dlx`** and a durable queue **`<q>.dlq`** bound to it; the work queue is
declared with `arguments={"x-dead-letter-exchange": "<q>.dlx"}`, prefetch/Qos 16, publisher confirms on.
(An existing queue declared without these args cannot be redeclared with them — drain/delete on rollout.)

**Job message** (Python → Go):
```json
{ "type":"asm|vs|ca", "priority":"high|medium|low", "task_id":"uuid",
  "org_id":"uuid", "asset_id":"uuid|null", "targets":["..."],
  "mode":"LIGHT|NORMAL|DEEP", "config":{} }
```
Dispatch is by the `type` field. For ASM, `task_id` **is** the `asm_discoveries.id`; for VS it is the
`vs_scan_runs.id`. VS-specific fields (engines, safe_mode, credential_id, structured targets) ride in `config`.

**Task states**: `PENDING → ADMITTED → RUNNING → COMPLETED | FAILED | CANCELLED`. `asm_discovery_runs.status`
is a Postgres enum extended with `ADMITTED`/`CANCELLED` (migration `scan_redesign_task_states`).

**Redis keys**:
| Key | Purpose |
|---|---|
| `slots:{service}` | atomic (Lua) acquire/release vs the per-service cap → global concurrency |
| `task:{task_id}` | live pipeline JSON `{status,current_stage,stages:[{name,tool,status,result}],started_at}` |
| `task:{task_id}:cancel` | set by FastAPI to request cooperative cancellation |
| `task:{task_id}:lease` | TTL heartbeat; the reaper fails a RUNNING task whose lease expired |
| `task_events:{org_id}` | pub/sub channel the worker publishes stage/task events on; FastAPI SSE subscribes |

**Internal credential fetch** (VS authenticated scans, unchanged): `POST {CORE_API_URL}/api/v1/internal/vs/credential`,
header `X-Internal-Token` = `CONTROL_PLANE_TOKEN`. The decrypted secret is held in memory only, never serialized.

## 3. Worker structure (`worker/`, Go module `worker`)

```
worker/
├── main.go              # boot: config, pg/redis/rabbit, register services, reaper, consume
├── config/              # env + pg pool (pgx) + redis client + rabbit URL  (migrated)
├── utils/               # exectool.go (single LookPath/RunCommand) + logger.go  (migrated)
├── core/                # THE shared engine
│   ├── contract.go      #   queues, states, Redis key schema (locked)
│   ├── service.go       #   Service interface + registry
│   ├── task.go          #   Job / Stage / Task + Redis state persistence
│   ├── admission.go     #   Lua slot acquire/release, lease, cancel
│   ├── events.go        #   publish task_events:{org_id}
│   ├── queue.go         #   DLX topology + bounded pool + drain + dispatch + reporting publisher + DLQ retry
│   ├── engine.go        #   admit → run stages → state → events → cancel → SaveFindings → terminal
│   └── reaper.go        #   lease-expiry → FAILED
├── tools/               # self-registering tool adapters (one contract, ~59 tools)
│   ├── capability.go    #   Capability interface + Input/Finding/Output
│   ├── registry.go      #   name → Capability
│   ├── prior.go         #   cross-stage data flow (Subjects by finding Type)
│   ├── asm_domain.go    #   subfinder/crtsh/ai/amass/bbot/dnsgen/dnsx/http_probe/httpx/nuclei/ip_mapping
│   ├── adapt_*.go       #   naabu/nmap/sslscan/gobuster/cloudenum/emailleak/reposcan/saasdetect + ip_* + enrichers
│   ├── vs_engines.go    #   vs_nuclei / vs_sslyze / vs_nmap_nse / vs_default_login (credential threaded)
│   └── ca_tools.go      #   ca_evaluate (hands off to the Python CA engine)
└── services/            # thin, STRUCTURALLY IDENTICAL per-service files
    ├── asm.go + asm_stages.go   # PipelineConfig per asset-type × intensity
    ├── vs.go            # enabled engines → vs_* tools
    └── ca.go            # single compliance_evaluation stage
```

**The one abstraction.** Every tool implements `Capability{ Name() string; Run(ctx, Input) (Output, error) }`
and self-registers in `init()`. The engine resolves a stage via `tools.Get(stage.Tool)` — no switch, no giant
import block. A tool not registered is SKIPPED (visible in task state), so partial pipelines degrade gracefully.

**Cross-stage data flow.** The engine accumulates every stage's findings and passes them to the next stage as
`Input.Params["prior_findings"]`. Tools consume by finding **Type** (`subdomain → resolution/ip → reachable →
http → vuln`) via `tools.Subjects(in, type)`, so tools chain without hard-coding stage names.

**The Service interface** (all three files expose this identical method set, in identical order):
```go
type Service interface {
    Name() string                                   // "asm" | "vs" | "ca"
    Queues() []string                               // asm.high, asm.medium, asm.low
    Stages(job Job) []Stage                         // pick by mode / asset-type / engines
    SaveFindings(ctx, task *Task, stage Stage, out tools.Output) error
}
```

## 4. End-to-end flow

```
FastAPI intake (asm/vs/ca service.py or POST /api/v1/internal/scans/enqueue)
   └─ publish_scan_job → <type>.<priority>  (unified job message)
        └─ Go worker consumes → dispatch by type → engine.Run(service, job)
             ├─ AcquireSlot(slots:{service})              (ErrRequeue if at capacity)
             ├─ build Task from service.Stages(job); persist task:{id}; emit ADMITTED
             ├─ SetLease + heartbeat goroutine
             ├─ for each stage:  check cancel → run tools.Get(tool) → record status/result
             │        → accumulate findings → service.SaveFindings → reporting queue (stage_findings)
             │        → persist task:{id}; publish task_events:{org_id}
             ├─ COMPLETED/CANCELLED/FAILED → persist + emit + reporting (task_terminal)
             └─ ReleaseSlot; ClearLease
   Python reporting consumers (backend/reporting/{asm,vs,ca}/consumer.py) on `reporting.<service>`:
        ├─ asm stage_findings → upsert asm_subdomains/asm_ips/asm_api_endpoints (on_conflict)
        ├─ asm task_terminal   → update AsmDiscovery.status + dispatcher notify + CA hook
        ├─ vs stage_findings   → buffer; task_terminal → ingest_vs_result (dedup/risk/lifecycle) → vs_findings
        └─ ca task_terminal    → trigger_ca_evaluation(org_id) (Python CA engine → ca_gaps/ca_control_states)
   FastAPI SSE  GET /api/v1/scans/events?token=  subscribes task_events:{org_id} → browser (useScanTaskStream.tsx)
   Cancel       POST /api/v1/scans/{task_id}/cancel  (org-scoped) → sets task:{id}:cancel
```

**ASM** pipelines are `PipelineConfig[asset_type][intensity]` (asset types domain/ip/service/cloud/human/repo/saas/user
× LIGHT/NORMAL/DEEP). The domain chain is fully backed by real recon tools; the IP pipeline (`ip_target_seed →
alive → port scan → service → http → tls → enrichment → rdap`) is ported with the SSRF guard + CIDR expansion preserved.

**VS** stages are the enabled engines; each `vs_*` tool reuses the recon wrapper (nuclei/sslscan/nmap) and maps
results into the report.vs finding shape. The authenticated-scan credential is fetched JIT and never serialized.

**CA** has no external scanner — its single stage emits a request marker; the Python reporting consumer runs the
existing CA engine (`evaluate_org_isolated`) over the org's Postgres evidence.

## 5. Resilience

- **Admission**: atomic Lua on `slots:{service}` (ASM=2, VS=2, CA=3 by default, env-overridable). At capacity →
  `ErrRequeue` → Nack(requeue) with a small delay (no hot-loop).
- **Reaper**: scans `task:*`, fails any RUNNING task whose lease expired (crash recovery), `SetNX`-claimed so
  multiple workers don't double-finalize.
- **Cancel**: honored between stages; task → CANCELLED, terminal published.
- **DLQ bounded retry**: a failing message is republished with an `x-retry-count` header up to 3 times, then
  dead-lettered. Malformed messages and unknown types are handled without poison-looping.
- **Graceful drain**: SIGINT/SIGTERM stops intake and drains in-flight jobs (bounded) before exit.

## 6. Running it

- **Worker**: `cd worker && go build ./... && ./worker` (loads `worker/.env`; needs recon tools on PATH).
  Docker: `docker build -f worker/deploy/Dockerfile -t cybersentinel-worker .` (compose service `consumer`).
- **API**: `cd backend/api_service && .venv-run/bin/python -m uvicorn main:app --reload --port 8000` (use the 3.11 venv).
- **Reporting**: one consumer per service — `python -m backend.reporting.asm` (and `.vs`, `.ca`), run from
  repo root with `PYTHONPATH=ROOT:ROOT/backend:ROOT/backend/api_service`. Or start everything with `./scripts/dev.sh`.
- **Migration**: `cd backend/api_service && alembic upgrade head` (adds ADMITTED/CANCELLED to `asm_run_status`).

## 7. Known follow-ups

- ASM reporting persists subdomain/ip/http finding types; port/service/tls/vuln/cloud types map to their tables
  when needed (logged, not yet persisted).
- Multi-asset ASM discoveries run as one pipeline; findings attribute to the first asset_id.
- The VS finding buffer in the reporting consumer is in-memory (lost on consumer restart for in-flight scans).
- The three copies of the SSRF guard/CIDR helper across `adapt_ip_*.go` can be de-duplicated.
- DLQ retries are immediate (no delay exchange).
- `backend/workers/` (the old worker) is retired functionally (nothing publishes to `jobs.asm`/`jobs.vs`) and can
  be deleted once the new worker is confirmed in your environment.

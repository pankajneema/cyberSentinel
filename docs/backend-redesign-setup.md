# CyberSentinel — Backend Redesign: Fresh Setup Plan (asm / vs / ca)

Ground rules we agreed:
- **Go worker = execution only** (concurrent tool runs). No Gin control-plane.
- **Python (FastAPI) = intake, scheduling, task command/query API, live SSE, reporting, notifications.**
- **Redis = concurrency slots + live task/progress state + cancel flag + pub/sub.**
- **Postgres = durable task/run state + findings** (written incrementally).
- **RabbitMQ = per-service, per-priority queues** with DLX.
- Reuse only the **tools** and the **ASM pipeline** (as reference). Everything else fresh.

> Assumptions (correct me if wrong): (1) Gin dropped. (2) Priority = separate
> queues `asm.high/medium/low`. (3) Findings saved to Postgres as each stage
> finishes, not only at report time. (4) "Auto" = re-scan on a fixed cadence.

---

## 0. Contracts to lock FIRST (write these down before code)

**Queue topology (RabbitMQ)**
- Job queues: `asm.high`, `asm.medium`, `asm.low`, `vs.high`, `vs.medium`, `vs.low`, `ca.high`, `ca.medium`, `ca.low`
- Each with `x-dead-letter-exchange` → `<name>.dlq` (reuse the DLX helper already on both sides).
- Reporting queue: `reporting` (+ `reporting.dlq`).

**Job message schema (published by Python, consumed by Go)**
```json
{
  "type": "asm|vs|ca",
  "priority": "high|medium|low",
  "task_id": "uuid",
  "org_id": "uuid",
  "asset_id": "uuid|null",
  "targets": ["..."],
  "mode": "LIGHT|NORMAL|DEEP",   // asm intensity / vs|ca scan mode
  "config": { }
}
```

**Task lifecycle states** (Postgres + Redis agree):
`PENDING → ADMITTED → RUNNING → COMPLETED | FAILED | CANCELLED`

**Redis key schema**
- `slots:{service}` — integer, atomic acquire/release (Lua) vs configured max → global concurrency.
- `task:{task_id}` — JSON: `{status, current_stage, stages:[{name,tool,status,result,started,ended}], started_at}` (the live pipeline instance).
- `task:{task_id}:cancel` — set to request cancellation.
- `task:{task_id}:lease` — TTL heartbeat; reaper requeues if it expires while RUNNING.
- pub/sub channel `task_events:{org_id}` — worker publishes stage events; FastAPI SSE subscribes.

**Postgres**
- Reuse `asm_discoveries` + `asm_discovery_runs` for durable run/task state (add generic columns if vs/ca need them).
- Findings tables already exist for ASM (subdomains, ips, ports, services, ssl, endpoints…). Add equivalent finding tables for vs/ca when we get there.

---

## 1. Worker skeleton that compiles (simple layout)

```
worker/
├── main.go                     # connect rabbit+redis+pg, register services, start consumer pool
├── config/  config.go env.go db.go redis.go
├── utils/   logger.go queue.go dispatcher.go exectool.go
├── tools/   capability.go registry.go  <tool wrappers>  ai/
└── services/asm|vs|ca/
        module.go consumer.go job.go jobstore.go
        pipeline.go pipeline_config.go orchestrator.go
        executor.go repository.go flows/
```

Deliverables:
- `utils/queue.go` — connect / consume / ack / nack(DLX) + bounded worker pool + graceful drain (port the good logic we already have).
- `utils/dispatcher.go` — `msg.type` → the registered service.
- `tools/capability.go` (interface) + `tools/registry.go` (name→capability, self-register in `init()`).
- `utils/exectool.go` — shared `LookPath` + `Run(ctx, name, args, parse)`; every wrapper uses it (no more `getToolPath`).
- `services/asm` implementing the interface with a **no-op pipeline** first.
- ✅ `go build ./...` green before moving on.

## 2. Concurrency + task lifecycle (Redis + Postgres)

- Lua **acquire/release** on `slots:{service}` — worker admits itself; no HTTP hop.
- `jobstore.go` — create `task:{task_id}` instance in Redis; update per-stage results.
- `repository.go` — write run status transitions to Postgres (`asm_discovery_runs`).
- Lease/heartbeat + `:cancel` flag plumbing (used in phases 5 & 7).

## 3. ASM pipeline (port the good one)

- `pipeline_config.go` — the ASM stage→tool maps per intensity (reuse the existing good `PipelineConfig`).
- `pipeline.go` engine — for each stage: `tools.Get(stage.tool).Run(ctx, in)` → store result in Redis → publish event → **persist findings to Postgres incrementally** → check cancel flag between stages.
- Convert real tool wrappers into `tools/` capabilities, starting with `subfinder → dnsx → httpx`, then the rest.
- ✅ End-to-end ASM run works from a queued message to findings in DB.

## 4. Live events → UI (Python owns the socket)

- Worker publishes stage events to Redis pub/sub `task_events:{org_id}`.
- **FastAPI SSE/WebSocket** endpoint (org-scoped, auth’d) subscribes to Redis and streams to the browser. Browser never touches Redis directly.
- Frontend: live per-task view ("looking → finding → done" per stage).

## 5. Completion + reporting

- On pipeline done: worker pushes a `reporting` message, sets task `COMPLETED`, releases the slot, goroutine ends.
- **Python reporting consumer**: consume `reporting` → generate report → fire notification (task name + summary). Findings tab is already populated (incremental writes from phase 3).

## 6. Scheduling + auto mode

- Python scheduler/cron: on time match, publish to `{service}.{priority}` with the payload (reuse the recurring scheduler already built).
- Auto = fixed-cadence rescan → scheduler enqueues on interval.

## 7. Resilience

- **Reaper**: tasks in `RUNNING` whose Redis lease expired → requeue or mark `FAILED`.
- **Cancellation** end-to-end: FastAPI sets `task:{id}:cancel`; worker stops cleanly between stages; state → `CANCELLED`.
- DLQ inspection + bounded retries.

## 8. VS, then CA

- Copy the `services/asm` template verbatim; swap `pipeline_config.go` + the tools/adapters. Same engine, same lifecycle, same events. This is where the identical-structure decision pays off.

---

## Build order summary

0 Contracts → 1 Worker skeleton (compiles) → 2 Concurrency/lifecycle → 3 ASM pipeline
→ 4 Live SSE → 5 Reporting → 6 Scheduling/auto → 7 Resilience → 8 VS + CA.

Each phase compiles and is independently testable. Nothing is “done” until a real
queued ASM job flows end-to-end: **enqueue → admit → pipeline → live events →
findings in DB → reporting → notification.**

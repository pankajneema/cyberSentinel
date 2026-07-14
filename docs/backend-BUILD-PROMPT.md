# CyberSentinel — Backend Build Prompt (ASM / VS / CA worker)

> Paste everything below the line into your coding agent, run from the repo root.
> Companion design doc: `docs/CyberSentinel-Backend-Redesign.pdf`.
> Build in phases; the worker must compile (`go build ./...` + `go vet ./...`)
> after EVERY phase. No big-bang rewrite.

---

## ROLE

You are a **senior Go + Python engineer** building the CyberSentinel scan-execution
backend for three services — **ASM, VS, CA** — that all share ONE identical flow;
only their stage list and tools differ.

**Keep as reference (do not reinvent):**
- The existing **ASM pipeline / stage design** in `backend/workers/executor/asm/job_pipeline.go` (its `PipelineConfig` stage→tool maps are good — reuse them).
- The existing **tool wrappers** in `backend/workers/executor/tools/*` and the VS adapters in `backend/workers/executor/vs/*` (reuse the CLI-invocation logic; only change how they're wired in).

Everything else about the worker is redesigned per the flow below.

## ARCHITECTURE (fixed decisions)

- **Python (FastAPI)** owns everything user-facing: trigger, scheduler/cron, task command/query API, live progress stream (SSE/WebSocket), reporting consumer, notifications.
- **Go worker** does **execution only**: consume → admit (Redis slot) → build pipeline → run tools concurrently → save findings + progress → push to reporting queue. Stateless, horizontally scalable. **No Gin / no separate control-plane** — admission is an atomic Redis op; task state + command API live in FastAPI + Postgres (one source of truth).
- **Redis** = concurrency slots, live task/pipeline state, progress pub/sub, cancel flag, lease/heartbeat.
- **Postgres** = durable run state + findings (written incrementally, not only at the end).
- **RabbitMQ** = per-service, per-priority job queues + a reporting queue.

## HARD INVARIANTS

1. Compiles after every phase (`go build ./...`, `go vet ./...`, `gofmt -l .` clean). Commit per phase.
2. Publisher (Python) and consumer (Go) must agree **exactly** on queue names, the job message schema, task states, and the Redis key schema (Section: Contracts). Implement these as shared constants/structs, not magic strings.
3. Reuse the existing DLX (dead-letter) queue setup already present on both the Python and Go queue helpers — do not diverge the args.
4. Findings are persisted to Postgres **as each stage completes** (so the UI Findings tab is live).
5. The browser never reads Redis directly — live progress goes Redis pub/sub → FastAPI SSE/WebSocket → UI.
6. Prefer moving/reusing over rewriting; ask before deleting anything you're unsure is dead.

## CONTRACTS (Phase 0 — lock first)

**Queues (RabbitMQ):** `asm.high asm.medium asm.low  vs.high vs.medium vs.low  ca.high ca.medium ca.low`, each with `x-dead-letter-exchange → <name>.dlq`; plus `reporting` (+ `reporting.dlq`).

**Job message (Python → Go):**
```json
{ "type":"asm|vs|ca", "priority":"high|medium|low", "task_id":"uuid",
  "org_id":"uuid", "asset_id":"uuid|null", "targets":["..."],
  "mode":"LIGHT|NORMAL|DEEP", "config":{} }
```

**Task states:** `PENDING → ADMITTED → RUNNING → COMPLETED | FAILED | CANCELLED`.

**Redis keys:**
```
slots:{service}          atomic acquire/release vs max (global concurrency)
task:{task_id}           JSON {status,current_stage,stages:[{name,tool,status,result}],started_at}
task:{task_id}:cancel    set to request cancellation
task:{task_id}:lease     TTL heartbeat; reaper requeues if it expires while RUNNING
task_events:{org_id}     pub/sub; worker publishes, FastAPI SSE subscribes
```

**Postgres:** reuse `asm_discoveries` + `asm_discovery_runs` for durable state; ASM finding tables already exist; add VS/CA finding tables when those services are built.

## TARGET WORKER STRUCTURE (lean — one engine, thin services)

```
worker/
├── main.go              # boot, register asm/vs/ca, start consuming
├── config.go            # env + pg + redis + rabbit connections
├── queue.go             # consume/ack/nack(DLX) + publish + bounded worker pool + drain
├── pipeline.go          # THE engine: run stages → redis state → emit events → cancel → save hook
├── tools/
│   ├── registry.go      # name → run func (self-registering in init())
│   ├── exec.go          # shared LookPath + Run  (delete every getToolPath copy)
│   └── <tool>.go        # one thin file per tool (reuse existing wrapper logic)
└── services/
    ├── asm.go           # stage lists (per mode / asset-type) + SaveFindings   ← reuse existing PipelineConfig
    ├── vs.go            # same shape, VS stages + adapters
    └── ca.go            # same shape (scaffold if CA not defined yet)
```
A service answers only: **what stages, in what order** and **how to save findings.** The engine (consume, admit, run loop, Redis state, events, cancel, reporting hand-off) is shared.

## SERVICE FILE TEMPLATE (asm.go / vs.go / ca.go must be structurally IDENTICAL)

Every service file implements the **same `Service` interface**, defines the same
members **in the same order**, with the **same signatures**. Only the bodies
differ (ASM stages+tools vs VS stages+adapters vs CA). A reviewer diffing
`asm.go` and `vs.go` should see the exact same skeleton — different logic inside.

```go
// pipeline.go — the engine depends only on this interface
type Service interface {
    Name() string                                   // "asm" | "vs" | "ca"
    Queues() []string                               // e.g. asm.high, asm.medium, asm.low
    Stages(job Job) []Stage                         // choose stage list by mode/asset-type
    SaveFindings(ctx context.Context, task *Task, stage Stage, out Output) error
}
var services = map[string]Service{}
func RegisterService(s Service) { services[s.Name()] = s }
```

Required skeleton — copy this exact ordering into `asm.go`, `vs.go`, `ca.go`:

```go
package services

// 1) type
type asmService struct{}

// 2) self-register
func init() { RegisterService(&asmService{}) }

// 3) identity
func (s *asmService) Name() string     { return "asm" }

// 4) queues (same pattern; only the prefix differs)
func (s *asmService) Queues() []string { return []string{"asm.high", "asm.medium", "asm.low"} }

// 5) stages — THE ONLY place the pipeline differs (asm reuses the existing PipelineConfig)
func (s *asmService) Stages(job Job) []Stage { /* pick by job.Mode / asset-type */ }

// 6) persistence — how THIS service saves a stage's findings
func (s *asmService) SaveFindings(ctx context.Context, task *Task, stage Stage, out Output) error { /* ... */ }

// 7) private helpers below, if any
```

Invariant: all three files expose the identical method set in the identical order.
No service may add a public method the others lack, and no service-specific logic
may leak into `pipeline.go` — the engine only ever calls the four interface
methods. If VS needs something ASM doesn't, it goes inside `Stages`/`SaveFindings`
or a private helper, never a new interface method.

## TOOL/STAGE CONTRACT (the one abstraction)

```go
// tools/registry.go
type Input  struct { JobID, AssetID string; Targets []string; Params map[string]any }
type Output struct { Findings []Finding; Raw map[string]any }
type RunFunc func(ctx context.Context, in Input) (Output, error)
var reg = map[string]RunFunc{}
func Register(name string, f RunFunc) { reg[name] = f }
func Get(name string) (RunFunc, bool) { f, ok := reg[name]; return f, ok }
```
Every tool wrapper registers itself in `init()` and uses `tools.exec` for the actual command run. `pipeline.go` resolves each stage via `tools.Get(stage.Tool)` — no giant import block, no switch. This is also how a future AI service plugs in: it's just another `RunFunc`.

## PHASES (commit + `go build ./...` + `go vet ./...` after each)

0. **Contracts** — implement queue names, message struct, task states, Redis key helpers as shared code (Go side + matching Python side).
1. **Skeleton** — `main.go` + `config.go` + `queue.go` (reuse the good bounded-pool/drain logic) + `pipeline.go` engine + `tools/{registry,exec}` + `services/asm.go` with a **no-op** pipeline. Build green.
2. **Concurrency + lifecycle** — Redis slot acquire/release (atomic), `task:{id}` state, durable run-state writes to Postgres, lease + cancel plumbing.
3. **ASM pipeline** — port the existing `PipelineConfig` into `services/asm.go`; engine runs each stage via the tool registry; convert the real tool wrappers into registered `RunFunc`s (start with subfinder → dnsx → httpx, then the rest); **save findings to Postgres incrementally**.
4. **Live events** — worker publishes stage events to `task_events:{org_id}`; add the FastAPI SSE/WebSocket endpoint (org-scoped, authed) that streams them to the UI.
5. **Reporting** — on completion push to `reporting`; implement/verify the Python reporting consumer → report + notification.
6. **Schedule / auto** — Python scheduler publishes to the queues on cron match; auto = fixed-cadence rescan.
7. **Resilience** — stale-task reaper (lease expiry → FAILED/requeue), end-to-end cancellation, DLQ handling + bounded retries.
8. **VS then CA** — clone `services/asm.go`; swap the stage config + wrap the existing VS adapters as registered tools. Same engine, same lifecycle. Confirm `services/asm.go` and `services/vs.go` are structurally identical.

## DELIVERABLE / DEFINITION OF DONE

After each phase: `git diff --stat`, the build + vet result, and a one-line summary; stop and ask if a phase can't stay green. **Done = one real ASM job flows end to end:** enqueue → admit → pipeline → live events → findings in Postgres → reporting → notification, with working cancel and crash recovery. Then VS and CA are added by cloning ASM with different stages/tools.

Before Phase 0, ask me: (a) the Go **module path**, (b) whether **CA** is a real service now or just a scaffold, and (c) the **max concurrency** per service. Then begin.
```

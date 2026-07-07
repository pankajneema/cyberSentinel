# CyberSentinel — Go Worker Restructure Prompt (simple layout)

> Paste everything below the line into Claude CLI, run from the repo root.
> The module to restructure is `backend/workers/`. Execute in phases; the tree
> must compile (`go build ./...`) after EVERY phase. No big-bang rewrite.

---

## ROLE

You are a **senior Go engineer** restructuring the CyberSentinel **worker**
(`backend/workers/`, module `workers`). Today it's a layer-first mess: a flat
`executor/asm` god-package (`task.go` ~1590 lines), `getToolPath` copy-pasted into
~19 tool wrappers, raw SQL scattered through the executor, no tool abstraction,
and ASM/VS have different shapes.

Move to a **simple, service-based** layout: top level is just `config`, `utils`,
`tools`, and `services/`. Each service under `services/` (`asm`, `vs`, `ca`) is
**structurally identical end-to-end** — only the logic inside differs. All tool
wrappers live in a shared `tools/` and are resolved by name through a small
registry, so recon tools and future AI services plug in the same way.

## HARD INVARIANTS (do not violate)

1. **Compiles at every phase.** After each phase: `go build ./...`, `go vet ./...`, `gofmt -l .` clean. Commit per phase. Never leave the tree uncompilable.
2. **No behavior change** except the explicit "extract/split" steps. Same queues, same Ack/Nack/DLQ semantics, same SSRF guards, same tool CLI calls, same DB reads/writes.
3. **`services/asm`, `services/vs`, `services/ca` end up with the IDENTICAL file set** (same filenames + responsibilities). Only the logic differs. Do not let VS keep a different shape.
4. **One entrypoint:** a single `main.go` boots the queue consumer and registers all services. No per-service `main.go`.
5. Preserve the existing bounded worker-pool + graceful-drain logic from `consumer/start.go` — move it, don't rewrite the semantics.
6. Prefer moving over deleting; ask before deleting anything you're unsure is dead.

## MODULE PATH

Keep the module name simple: rename `workers` → `worker` (or a full path like
`github.com/<ORG>/cybersentinel/worker` if I give you `<ORG>`). **Ask me which
before Phase 1**, and whether `ca` is a real upcoming service or just a scaffold.

## TARGET STRUCTURE (simple)

```
worker/
├── main.go                     # single entrypoint; registers asm, vs, ca
├── config/
│   ├── config.go               # from config/config.go
│   ├── env.go                  # from config/env.go
│   ├── db.go                   # from database/postgresql.go
│   └── redis.go                # from database/redis.go
├── utils/
│   ├── logger.go               # from utils/logger.go
│   ├── queue.go                # from utils/queue.go + bounded pool/drain from consumer/start.go
│   ├── dispatcher.go           # from consumer/dispatcher.go (msg.type → service via registry)
│   └── exectool.go             # NEW shared LookPath + RunCommand (kills getToolPath ×19)
├── tools/                      # ALL tool wrappers live here, resolved by name
│   ├── capability.go           # NEW interface: Run(ctx, Input) (Output, error)
│   ├── registry.go             # NEW name → capability, self-registering
│   ├── subfinder/ amass/ crtsh/ dnsx/ dnsgen/ bbot/ gobuster/ katana/
│   ├── naabu/ nmap/ nuclei/ httpx/ httpprobe/ sslscan/ saasdetect/
│   ├── cloudenum/ reposcan/ emailleak/        # from executor/tools/*
│   └── ai/                     # AI capabilities, SAME interface
│       ├── client.go           # NEW LLM/provider client
│       └── subdomainprobe/     # from executor/tools/aisubs
└── services/
    ├── asm/                    # identical template ↓
    ├── vs/                     # identical template ↓
    └── ca/                     # identical template ↓
```

### Identical per-service template (asm / vs / ca all have exactly this)

```
services/<name>/
├── module.go            # Register(): queue name + job builder + stage wiring
├── consumer.go          # decode queue message → Job
├── job.go               # Job/Task/Result/State types + context helpers
├── jobstore.go          # per-job state persistence (redis)
├── pipeline.go          # stage engine — runs stages in order
├── pipeline_config.go   # stage → tool/capability map (per intensity / scan-mode)
├── orchestrator.go      # builds the pipeline for a job, coordinates flows
├── executor.go          # runs ONE stage via tools.Get(name)
├── repository.go        # ALL SQL for this service
└── flows/               # asset-type / mode-specific flows
```

## KEY ABSTRACTION (build in Phase 3, then adopt)

```go
// tools/capability.go
type Input  struct { JobID, AssetID string; Targets []string; Params map[string]any }
type Output struct { Findings []Finding; Raw map[string]any }
type Capability interface {
    Name() string
    Run(ctx context.Context, in Input) (Output, error)
}
// tools/registry.go
var reg = map[string]Capability{}
func Register(c Capability) { reg[c.Name()] = c }
func Get(name string) (Capability, bool) { c, ok := reg[name]; return c, ok }
```
Every tool wrapper + every AI service implements `Capability` and calls
`Register` in `init()`. `pipeline.go` resolves stages via `tools.Get(stage.Tool)` —
no giant import block, no switch. `utils/exectool.go` provides the shared
`LookPath(tool)` + `Run(ctx, name, args, parse)`; delete `getToolPath` from every
wrapper and fold in `executor/tools/verify.go`.

## FILE MAPPING (authoritative)

Moves/renames (content preserved, imports updated):
- `consumer/cmd/main.go` → `main.go` (rewrite wiring only)
- `consumer/start.go` → folded into `utils/queue.go` (bounded pool + drain)
- `consumer/dispatcher.go` → `utils/dispatcher.go` (use registry)
- `consumer/asm/job.go` → `services/asm/consumer.go`; `consumer/vs/job.go` → `services/vs/consumer.go`
- `utils/logger.go` → `utils/logger.go`; `utils/queue.go` → `utils/queue.go`
- `database/postgresql.go` → `config/db.go`; `database/redis.go` → `config/redis.go`
- `executor/asm/job_manager.go` → `services/asm/orchestrator.go`
- `executor/asm/job_pipeline.go` → split into `services/asm/pipeline.go` (engine) + `services/asm/pipeline_config.go` (the map)
- `executor/asm/task.go` (1590 lines) → split into `services/asm/executor.go` (per-stage runner) + `services/asm/repository.go` (all SQL); move parse helpers beside their stage
- `executor/asm/domain.go|ip.go|service.go` → `services/asm/flows/*.go`
- tiny types `executor/asm/{job.go,job_state.go,job_types.go,types.go,context.go}` → merged into `services/asm/job.go`
- `executor/asm/jobstore.go` → `services/asm/jobstore.go`
- every `executor/tools/<t>` → `tools/<t>`;  `executor/tools/aisubs` → `tools/ai/subdomainprobe`;  `executor/tools/verify.go` → folded into `utils/exectool.go`
- `executor/vs/scanner.go` → `services/vs/scanner.go` (then extract orchestrator/pipeline); `executor/vs/*_adapter.go` → `tools/` as capabilities (they're just tools)
- root `Dockerfile, install-tools.sh, setup-path.sh, mac-tolls.sh` → `deploy/` (fix typo → `install-tools-mac.sh`)

NEW files to author:
- Core: `utils/exectool.go`, `tools/capability.go`, `tools/registry.go`, `tools/ai/client.go`, rewritten `main.go` + `utils/dispatcher.go`
- asm: `services/asm/module.go`, `services/asm/executor.go`, `services/asm/repository.go`, `services/asm/pipeline_config.go`
- vs (fills the symmetry gap): `services/vs/module.go`, `services/vs/pipeline.go`, `services/vs/pipeline_config.go`, `services/vs/orchestrator.go`, `services/vs/executor.go`, `services/vs/job.go`, `services/vs/jobstore.go`, `services/vs/repository.go`
- ca: the full template as compiling stubs (empty logic + TODO)

## PHASES (commit + `go build ./...` + `go vet ./...` after each)

1. **Rename module** `workers → worker` (or full path); move ops files to `deploy/`. Mechanical; must build.
2. **Move infra:** `database/→config/{db,redis}.go`; add `main.go`; fold `consumer/start.go` into `utils/queue.go`; `consumer/dispatcher.go → utils/dispatcher.go`. Build.
3. **Add `tools/capability.go` + `tools/registry.go` + `utils/exectool.go`;** move `tools/{httpx,nmap,nuclei}` first, delete their `getToolPath`, make them implement the interface. Build.
4. **Repository layer:** create `services/asm/repository.go`, move every raw `SELECT/INSERT/UPDATE` out of the asm executor behind typed methods. Build.
5. **Feature-fold ASM:** create `services/asm/`, move & split `executor/asm/*` per the mapping (the `task.go` split). Move remaining `executor/tools/*` → `tools/*` and adopt the interface. Build.
6. **Symmetrize VS:** create the full `services/vs/` template incl. NEW `pipeline.go`/`pipeline_config.go`/`orchestrator.go`/`executor.go`; wrap `*_adapter.go` as capabilities in `tools/`. Build. Confirm `services/asm` and `services/vs` file sets are identical.
7. **Scaffold `services/ca/`** as compiling stubs; register all three in `main.go`. Build.
8. **AI slot:** `aisubs → tools/ai/subdomainprobe`, add `tools/ai/client.go`. Build.
9. **Cleanup:** delete now-empty `executor/`, `consumer/`, `database/` dirs; `gofmt -w .`; `go vet ./...`; run existing tests.

## DELIVERABLE

After each phase show me: `git diff --stat`, the `go build ./...` + `go vet ./...`
result, and a one-line summary. Stop and ask if a phase can't stay green. At the
end, give me a mapping table (old → new) and the list of files created. Do NOT
proceed past a phase that doesn't compile.

Start by asking me the module-path and `ca` questions, then do Phase 1.
```

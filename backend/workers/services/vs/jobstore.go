package vs

// jobstore.go is the VS analogue of services/asm/jobstore.go, which persists a
// per-job pipeline document in Redis (key asm:pipeline:{job_id}) and streams
// stage events as the pipeline advances.
//
// VS today runs a single stateless pass: each target is scanned by the enabled
// engines and ONE terminal report is published to report.vs (see consumer.go /
// orchestrator.go). It therefore keeps no incremental per-job Redis state.
//
// This file is the seam for that state when VS gains an incrementally-updated
// pipeline (per-engine progress events over the same Redis-key + websocket flow
// ASM uses). Add the jobstore load/save/publish helpers here so the VS service
// stays structurally identical to ASM.

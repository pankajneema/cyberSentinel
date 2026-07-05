# CyberSentinel — Vulnerability Scanning (VS) Module: Design & Build Plan

**Status:** design, ready to execute · **Author:** principal security eng · **Date:** 2026-07-05
**Scope:** net/web/TLS/service vuln scanning + CVE intel + risk-based prioritization + findings lifecycle, fitted to the existing stack without breaking ASM/auth.

> **Standard to beat:** Tenable VM, Rapid7 InsightVM, Qualys VMDR, Detectify.
> **Non-negotiables:** no mock data (every value from a real scan or DB), reuse the existing Asset Inventory (no parallel asset store), customer-configurable frequency with overlap prevention, exact stack (React/TS · FastAPI async · Postgres+async SQLAlchemy · Go workers on RabbitMQ).

---

## 0. How VS fits the current architecture (verified against the code)

| Concern | Existing thing to reuse | File |
|---|---|---|
| Job typing | `JobTypeVS = "vs"` already reserved; dispatcher type-switches on `body.Type` | `workers/orchestration/job_types.go`, `workers/consumer/dispatcher.go:22` |
| Queue pattern | `jobs.asm` (work) + `report.asm` (results→Python persist) | `routes/asm.py:340`, `workers/executor/runner/task.go` |
| Scan definition + scheduling | `AsmDiscovery` (target_source, intensity, schedule_type/value, next_run_at, status) | `models/asm_models.py` |
| Recurring + overlap + reaper | scheduler `_tick` (INTERVAL/CRON, `FOR UPDATE SKIP LOCKED`, stale reaper) | `utils/scheduler.py` |
| Tenancy | `_org_filter(model, current_user)` + `get_current_user` + `require_role` | `routes/asm.py`, `utils/supabase_auth.py` |
| Assets (promote-to-asset) | `assets` table: `org_id, user_id, name, type, exposure, risk_score, ownership_verified` | `models/asset_models.py` |
| **Risk scoring (already built!)** | `CveSignal(cvss, epss, kev)` + `AssetSignals` + weighted `score_exposure` | `scoring/exposure.py` |
| SSRF / scope guard | `target_guard.validate_scan_targets` + Go `isForbiddenScanIP` | `utils/target_guard.py`, `workers/executor/runner/ip.go` |
| Ownership gate | `REQUIRE_SCAN_VERIFICATION` + `assets.ownership_verified` | `routes/asm.py`, `routes/assets.py` |
| Notifications | `SCAN_*`, `FINDING_CRITICAL/HIGH` events + settings-gated fanout | `notificationservice/events.py`, `dispatcher.py` |
| Reports | real PDF (reportlab) + report-type branching + attachment delivery | `routes/reports.py` |

**Key architectural decision:** VS is a *sibling* of ASM, not a fork. Same consumer binary, same scheduler, same scoring engine, same reporting/notification rails — a new job type (`vs`), a dedicated queue (`jobs.vs` / `report.vs`), and a scanner-adapter layer. The in-memory `scans_db`/`results_db` in `routes/vs.py` is deleted and replaced by real tables.

---

## 1. PostgreSQL data model (async SQLAlchemy)

All tables are `org_id`-scoped (FK → organizations, `ondelete=CASCADE`, indexed) and carry `created_at`/`updated_at`. Findings link to the **existing** `assets` table. New file: `models/vs_models.py`; migration: `migrations/versions/vs_module.py`.

```
organizations ──┐
                │ org_id (every VS table)
assets ─────────┼──< vs_findings.asset_id            (FK, ondelete CASCADE)
                │
vs_scan_profiles ──< vs_scans.profile_id
vs_scans ──< vs_scan_runs ──< vs_scan_targets
                      │            │
                      └──< vs_findings >── vs_cve_metadata (cve_id, not FK-cascade: shared cache)
                                 ├──< vs_finding_history
                                 └──< vs_remediation
vs_credentials (encrypted, referenced by profile/scan for authenticated scans)
```

### 1.1 `vs_scan_profiles` — reusable, customer-configurable scan configuration
```python
class VsScanProfile(Base):
    __tablename__ = "vs_scan_profiles"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    intensity = Column(String, nullable=False, default="standard")   # light|standard|deep
    engines = Column(JSON, nullable=False, default=list)             # ["nuclei","nmap_nse","sslyze"]
    authenticated = Column(Boolean, nullable=False, default=False)
    credential_id = Column(String, ForeignKey("vs_credentials.id", ondelete="SET NULL"), nullable=True)
    safe_mode = Column(Boolean, nullable=False, default=True)        # block intrusive/DoS templates
    max_requests_per_sec = Column(Integer, nullable=False, default=20)  # per-target throttle
    scan_window = Column(JSON, nullable=True)                        # {"start":"22:00","end":"06:00","tz":"UTC"}
    web_scan = Column(Boolean, nullable=False, default=True)         # OWASP top-10 pass
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

### 1.2 `vs_scans` — scan definition + schedule (mirrors `AsmDiscovery`)
```python
class VsScan(Base):
    __tablename__ = "vs_scans"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    profile_id = Column(String, ForeignKey("vs_scan_profiles.id", ondelete="RESTRICT"), nullable=False)
    asset_ids = Column(JSON, nullable=False, default=list)   # from Asset Inventory — NO parallel store
    schedule_type = Column(String, nullable=False, default="QUICK")  # QUICK|INTERVAL|CRON
    schedule_value = Column(String, nullable=True)                    # "24h" | "0 2 * * *"
    status = Column(String, nullable=False, default="PENDING")       # PENDING|RUNNING|COMPLETED|FAILED|PAUSED|DELETED
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)         # scheduler due-poll (indexed)
    last_run_id = Column(String, nullable=True)                       # overlap prevention: skip if its run RUNNING
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```
**Overlap prevention:** scheduler skips a scan whose `status == RUNNING`, identical to ASM's `status.notin_(("RUNNING","PAUSED","DELETED"))` + `FOR UPDATE SKIP LOCKED`.

### 1.3 `vs_scan_runs` — one execution instance (mirrors `AsmDiscoveryRun`)
```python
class VsScanRun(Base):
    __tablename__ = "vs_scan_runs"
    id = Column(String, primary_key=True, default=_uuid)
    scan_id = Column(String, ForeignKey("vs_scans.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="PENDING")   # PENDING|RUNNING|COMPLETED|FAILED|CANCELLED
    triggered_by = Column(String, nullable=False, default="schedule")  # schedule|manual|rescan
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    engine_versions = Column(JSON, nullable=True)   # {"nuclei":"3.x","templates":"<sha>","sslyze":"..."} — provenance
    stats = Column(JSON, nullable=True)             # {"targets":N,"findings":N,"new":N,"fixed":N,"reappeared":N}
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
```

### 1.4 `vs_scan_targets` — resolved, authorized targets for a run
```python
class VsScanTarget(Base):
    __tablename__ = "vs_scan_targets"
    id = Column(String, primary_key=True, default=_uuid)
    scan_run_id = Column(String, ForeignKey("vs_scan_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    host = Column(String, nullable=False)         # resolved ip/hostname/url
    ports = Column(JSON, nullable=True)
    authorized = Column(Boolean, nullable=False, default=False)   # ownership-verified at enqueue time (audit)
    status = Column(String, nullable=False, default="pending")     # pending|scanned|skipped|error
```

### 1.5 `vs_cve_metadata` — authoritative CVE intelligence cache (REAL feeds)
```python
class VsCveMetadata(Base):
    __tablename__ = "vs_cve_metadata"
    cve_id = Column(String, primary_key=True)     # "CVE-2024-1234"
    cvss_v31_score = Column(Float, nullable=True)
    cvss_v31_vector = Column(String, nullable=True)
    cvss_v40_score = Column(Float, nullable=True)
    cvss_v40_vector = Column(String, nullable=True)
    epss_score = Column(Float, nullable=True)      # 0..1 (EPSS model)
    epss_percentile = Column(Float, nullable=True)
    kev = Column(Boolean, nullable=False, default=False)   # CISA KEV catalog
    kev_date_added = Column(DateTime, nullable=True)
    kev_due_date = Column(DateTime, nullable=True)
    cwe_ids = Column(JSON, nullable=True)
    affected_versions = Column(JSON, nullable=True)   # CPE ranges for version matching
    references = Column(JSON, nullable=True)
    published_at = Column(DateTime, nullable=True)
    modified_at = Column(DateTime, nullable=True)
    last_synced_at = Column(DateTime, nullable=True, index=True)
```
Populated by a **feed-sync job** (§3.5) from NVD 2.0 API, CISA KEV JSON, and FIRST EPSS CSV. This table is **org-agnostic shared intelligence** (not tenant data) — no `org_id`.

### 1.6 `vs_findings` — the core finding (links to existing `assets`)
```python
class VsFinding(Base):
    __tablename__ = "vs_findings"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_run_id = Column(String, ForeignKey("vs_scan_runs.id", ondelete="SET NULL"), nullable=True)
    first_seen_run_id = Column(String, nullable=True)     # for delta/age
    dedup_key = Column(String, nullable=False, index=True) # sha256(asset_id|plugin|cve|location) — cross-scan dedupe
    source_engine = Column(String, nullable=False)         # nuclei|nmap_nse|sslyze|openvas
    plugin_id = Column(String, nullable=True)              # template/NSE/plugin id (provenance)
    cve_id = Column(String, ForeignKey("vs_cve_metadata.cve_id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)               # owasp_a03|tls|default_creds|cve_match|misconfig
    location = Column(JSON, nullable=True)                 # {"port":443,"url":".../login","param":"q"}
    evidence = Column(Text, nullable=True)                 # sanitized request/response snippet
    confidence = Column(String, nullable=False, default="tentative")  # tentative|firm|confirmed
    severity = Column(String, nullable=False)              # critical|high|medium|low|info (from composite)
    cvss_base = Column(Float, nullable=True)
    epss = Column(Float, nullable=True)
    kev = Column(Boolean, nullable=False, default=False)
    composite_risk = Column(Integer, nullable=True)        # 0..100 (see §4)
    risk_factors = Column(JSON, nullable=True)             # explainable breakdown (ScoreFactor list)
    status = Column(String, nullable=False, default="open", index=True)  # lifecycle (§ below)
    assigned_to = Column(String, nullable=True)
    sla_due_at = Column(DateTime, nullable=True, index=True)
    first_detected_at = Column(DateTime, server_default=func.now())
    last_detected_at = Column(DateTime, server_default=func.now())
    resolved_at = Column(DateTime, nullable=True)
    __table_args__ = (UniqueConstraint("org_id", "dedup_key", name="uq_vs_finding_dedup"),)
```
**Lifecycle state machine:** `open → confirmed → in_progress → remediated → verified → closed`, plus `accepted_risk` and `false_positive` (both require justification, recorded in history). Transitions enforced server-side.

### 1.7 `vs_finding_history` — audit trail / state transitions
```python
class VsFindingHistory(Base):
    __tablename__ = "vs_finding_history"
    id = Column(String, primary_key=True, default=_uuid)
    finding_id = Column(String, ForeignKey("vs_findings.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=False)
    actor_user_id = Column(String, nullable=True)   # null = system (scan-driven: reappeared/auto-verified)
    justification = Column(Text, nullable=True)      # required for accepted_risk/false_positive
    at = Column(DateTime, server_default=func.now(), index=True)
```

### 1.8 `vs_remediation` — guidance (per CVE or per finding)
```python
class VsRemediation(Base):
    __tablename__ = "vs_remediation"
    id = Column(String, primary_key=True, default=_uuid)
    cve_id = Column(String, nullable=True, index=True)       # remediation keyed by CVE (shared) ...
    finding_id = Column(String, ForeignKey("vs_findings.id", ondelete="CASCADE"), nullable=True)  # ... or specific finding
    org_id = Column(String, nullable=True)                   # null = shared/global guidance
    summary = Column(Text, nullable=False)
    fixed_version = Column(String, nullable=True)
    steps = Column(JSON, nullable=True)
    references = Column(JSON, nullable=True)
    effort = Column(String, nullable=True)                   # low|medium|high
```

### 1.9 `vs_credentials` — encrypted creds for authenticated scans
```python
class VsCredential(Base):
    __tablename__ = "vs_credentials"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    cred_type = Column(String, nullable=False)         # http_basic|http_form|ssh|bearer
    username = Column(String, nullable=True)
    secret_ciphertext = Column(LargeBinary, nullable=False)   # ⚠ envelope-encrypted, NEVER plaintext
    secret_kms_key_id = Column(String, nullable=True)          # KMS key ref / rotation id
    created_at = Column(DateTime, server_default=func.now())
```
> 🔒 **Security flag:** secrets are stored as ciphertext only, encrypted with a KMS data key (or Fernet with a key from env/secrets-manager, never committed). The worker fetches a **short-lived decrypted credential over an authenticated internal channel** at scan time; it is never persisted decrypted and never logged. Access is audit-logged.

---

## 2. FastAPI route design (replaces the `vs.py` stub)

New files: `routes/vs_scans.py`, `routes/vs_findings.py`, `routes/vs_profiles.py`, `routes/vs_dashboard.py`, `schemas/vs_schema.py`. All routes: `Depends(get_current_user)`, org-scoped via `_org_filter`, **writes gated by `require_role("owner","admin","analyst")`**. The old `scans_db`/`results_db` dicts are removed.

### 2.1 Scans & scheduling
```
POST   /api/v1/vs/scans                 create scan (asset_ids from inventory, profile, schedule)
GET    /api/v1/vs/scans                 list (paged, org-scoped)
GET    /api/v1/vs/scans/{id}            detail
PATCH  /api/v1/vs/scans/{id}            update (schedule/profile/assets)
DELETE /api/v1/vs/scans/{id}            soft delete
POST   /api/v1/vs/scans/{id}/run        run now (enqueue jobs.vs)  ← ownership + SSRF gate here
POST   /api/v1/vs/scans/{id}/pause      pause schedule
POST   /api/v1/vs/scans/{id}/resume     resume
POST   /api/v1/vs/scans/{id}/stop       cancel in-flight run
GET    /api/v1/vs/scans/{id}/runs       run history
```
`create`/`run` **reject any asset that is not `ownership_verified`** (reuse `REQUIRE_SCAN_VERIFICATION`) and validate resolved targets with `target_guard` (SSRF). Response schema mirrors ASM's `AsmDiscoveryResponse`.

### 2.2 Profiles & credentials
```
GET/POST/PATCH/DELETE  /api/v1/vs/profiles
GET/POST/DELETE        /api/v1/vs/credentials    (secret write-only; never returned)
```

### 2.3 Findings & lifecycle
```
GET   /api/v1/vs/findings              filter (severity, status, asset, cve, kev, assigned), sort, paginate
GET   /api/v1/vs/findings/{id}         full detail (+ cve_metadata + remediation + history + risk_factors)
PATCH /api/v1/vs/findings/{id}/status  transition (validated state machine; justification for accepted/fp)
PATCH /api/v1/vs/findings/{id}/assign  set owner
POST  /api/v1/vs/findings/bulk         bulk status/assign
GET   /api/v1/vs/cve/{cve_id}          CVE intelligence
```
Every status transition writes `vs_finding_history` + emits a notification event; illegal transitions → 409.

### 2.4 Dashboard & reports (REAL aggregates — no hardcoded 4.2/87)
```
GET   /api/v1/vs/dashboard             severity counts, KEV count, MTTR (from history), SLA breaches,
                                       scan coverage = scanned_assets/total_assets — all SQL aggregates
GET   /api/v1/vs/reports               generate exec/technical (reuse reports.py renderers → PDF/CSV/JSON)
POST  /api/v1/vs/reports/schedule      scheduled VS reports (reuse scheduled-report machinery)
```

**Request/response schemas** (`schemas/vs_schema.py`) are Pydantic v2 mirroring `asm_schema.py` conventions: `VsScanCreate`, `VsScanResponse`, `VsFindingResponse`, `VsFindingStatusUpdate(status, justification?)`, `VsDashboardResponse`, `VsCveResponse`.

---

## 3. Go worker + RabbitMQ design

### 3.1 Coexistence with ASM
- **Dispatcher:** add `case JobTypeVS: return vs.HandleJob(body)` in `workers/consumer/dispatcher.go` (already type-switches on `body.Type`).
- **Queues:** dedicated `jobs.vs` (work) and `report.vs` (results → Python VS consumer), declared alongside `jobs.asm`/`report.asm`. Separate queues give VS its **own prefetch/concurrency cap** (VS scans are heavier and slower than ASM) and independent DLQ, without starving ASM. Same ACK-after-success + publisher-confirm + DLQ semantics already in `utils/queue.go`.
- **Consumer binary:** same process; VS handler runs on the existing bounded worker pool.

### 3.2 VS job schema (published by `POST /run` and the scheduler)
```json
{
  "type": "vs",
  "id": "<vs_scan_run_id>",
  "scan_id": "<vs_scan_id>",
  "org_id": "<org>",
  "profile": { "intensity":"standard", "engines":["nuclei","sslyze","nmap_nse"],
               "authenticated":false, "safe_mode":true, "max_rps":20, "web_scan":true },
  "credential_ref": "<vs_credential_id|null>",
  "targets": [ { "asset_id":"...", "host":"1.2.3.4", "url":"https://...", "ports":[443,8080] } ]
}
```

### 3.3 Scanner adapter interface (pluggable engines)
```go
// workers/executor/vs/scanner.go
type Target struct { AssetID, Host, URL string; Ports []int }
type RawFinding struct {
    Engine, PluginID, Title, Description, Category string
    CVEs      []string
    CVSSBase  float64          // if the engine supplies one; else enriched later
    Severity  string           // engine's own; re-derived in normalization
    Location  map[string]any   // port/url/param
    Evidence  string
    Confidence string          // tentative|firm|confirmed
}
type Scanner interface {
    Name() string
    Supports(profile Profile) bool
    Scan(ctx context.Context, t Target, profile Profile) ([]RawFinding, error)
}
```
**Adapters (all shell out to pinned binaries, no linked libs — matches ASM):**
- `NucleiScanner` — `-jsonl` templates (CVEs, misconfig, exposures, default-creds, OWASP). Primary engine.
- `NmapNSEScanner` — `--script vuln,ssl-*` for service/CVE + weak-cipher checks.
- `SslyzeScanner` — TLS/SSL weaknesses (protocols, ciphers, cert issues) as structured JSON.
- `NaabuServiceScanner` — port/service surface feeding version→CVE matching.
- `OpenVASScanner` (phase 4) — Greenbone feed via GVM socket, normalized to `RawFinding`.
Each adapter is **safe-mode aware** (drops intrusive/DoS templates) and **rate-limited** (`max_rps` token bucket per target).

### 3.4 Normalization → persistence pipeline
1. Worker runs each enabled adapter per target, honoring `safe_mode`, throttle, scan-window, and per-job/per-tool `context.WithTimeout` + per-stage `recover()` (reuse ASM reliability).
2. Adapter `RawFinding`s → normalized schema (dedup_key, category mapping, evidence **sanitized** with the same recursive sanitizer as reporting).
3. Worker publishes normalized findings to `report.vs`.
4. **Python VS reporting consumer** (`backend/reporting/vs/main.py`, sibling of ASM's) persists via **idempotent upsert** on `(org_id, dedup_key)` — `ON CONFLICT DO UPDATE` refreshes `last_detected_at`, re-opens if previously remediated (**reappeared** delta), leaves lifecycle otherwise intact.
5. Consumer **enriches** each finding: joins `cve_id → vs_cve_metadata` (CVSS/EPSS/KEV), computes **composite risk** (§4), sets `sla_due_at` by severity, computes run deltas (new/fixed/reappeared), updates `vs_scan_runs.stats`.
6. Emits `SCAN_COMPLETED` + `FINDING_CRITICAL` (KEV/critical) via the existing notification dispatcher.

> 🔒 **Security flags:** (a) targets re-validated in the worker with `isForbiddenScanIP` after DNS resolution (defeats rebinding) — **never scan private/link-local/metadata**; (b) an asset absent from the run's `authorized` set is dropped, not scanned; (c) evidence blobs sanitized before persist (stored-XSS); (d) credentials fetched decrypted just-in-time, zeroized after use, never logged.

### 3.5 CVE intelligence feed-sync (real data, not fabricated)
A scheduled job (new `_sync_cve_intel` in `utils/scheduler.py`, daily) populates `vs_cve_metadata`:
- **NVD 2.0 API** → CVSS v3.1 + v4.0 vectors/scores, CWE, CPE affected-version ranges (incremental by `lastModified`).
- **CISA KEV** JSON catalog → `kev`, `kev_date_added`, `kev_due_date`.
- **FIRST EPSS** daily CSV → `epss_score`, `epss_percentile`.
Version→CVE matching uses the CPE ranges vs the service/version detected by the scanner. This is the ONLY correct source of severity/exploit data — nothing is invented.

---

## 4. Risk-scoring algorithm (composite, explainable, exceeds CVSS-only)

VS does **not** rank by CVSS alone. It reuses the platform's existing weighted engine (`scoring/exposure.py`, which already models `CveSignal(cvss, epss, kev)` + context) so VS risk and ASM exposure are one coherent system.

**Per-finding composite risk (0–100):**
```
threat   = 0.50 · (CVSS_base / 10)          # severity        (0..1)
         + 0.30 · EPSS                        # exploit likelihood (0..1)
         + 0.20 · (KEV ? 1 : 0)               # active exploitation (0/1)

context  = exposure_mult · criticality_mult
             exposure_mult:  public/internet-facing = 1.30,  internal = 0.80   (from assets.exposure)
             criticality_mult: critical 1.40 · high 1.20 · normal 1.00 · low 0.80  (asset business context)

confidence_factor: confirmed 1.00 · firm 0.85 · tentative 0.60   # unverified findings discounted

composite = clamp( round( threat · 100 · context · confidence_factor ), 0, 100 )

# KEV override — active exploitation on an internet-facing asset is top priority:
if KEV and asset is public:  composite = max(composite, 90)
```
**Severity band** from composite: ≥90 critical · ≥70 high · ≥40 medium · ≥15 low · else info.
**Explainability:** each multiplier/term is stored as a `ScoreFactor{name, points, detail}` in `vs_findings.risk_factors` and rendered in the UI ("why this score") — same pattern as the exposure "why" panel.
**Roll-up:** a finding's `CveSignal(cvss, epss, kev)` also feeds the asset's `score_exposure()` → the asset's `risk_score` now reflects real CVEs (this is exactly the `CveSignal` path that's currently unfed). One asset, one risk number, VS + ASM combined.

> Why this beats CVSS-only (Tenable VPR / Qualys TruRisk parity): EPSS injects real-world exploit probability, KEV forces known-exploited to the top, and asset exposure/criticality means an internet-facing critical outranks an unreachable one with the same CVSS — with every input shown, not a black box.

---

## 5. Frontend (React/TS, existing design system)

The VS page shell exists (`pages/app/VS.tsx`); replace fake tiles/services with real fetches. New service `lib/services/vs.ts` (mirrors `asm.ts`). Reuse `RiskGauge`, `SeverityBadge`, `EmptyState`, `StatCard`, `exportRowsToCsv`, the WS `useRealtime` hook.

```
components/vs/
  VSScanManager.tsx     ← mirror DiscoveryManager: create wizard (asset picker from inventory,
                          profile select, intensity, authenticated toggle, credential select,
                          schedule interval/cron), run/pause/resume/stop, run history
  VSProfiles.tsx        profile CRUD
  VSDashboard.tsx       REAL: severity donut, KEV count, MTTR, SLA breaches, coverage (from /vs/dashboard)
  VSFindingsList.tsx    ← mirror ASMFindings: filter/sort/paginate, severity + composite-risk + KEV/EPSS chips,
                          bulk actions, CSV export
  VSFindingDetail.tsx   CVSS v3.1/v4.0 vectors, EPSS %, KEV badge, affected versions, evidence,
                          remediation steps, "why this score" factor breakdown, history timeline
  RemediationWorkflow.tsx  lifecycle buttons (state machine), assign, SLA countdown,
                          justification modal for Accepted-Risk / False-Positive
```
Live scan progress + new-critical toasts come through the existing `useRealtime` WebSocket (VS emits the same `scan.*`/`finding.critical` events). **No `Math.random`, no hardcoded counts** — every number from `/api/v1/vs/*`.

---

## 6. Phased build plan + explicit real-data replacements

| Phase | Deliverable | Real data replaces |
|---|---|---|
| **1. Data + intel** | `models/vs_models.py` + Alembic `vs_module` migration; CVE feed-sync job (NVD/KEV/EPSS) | `vs_cve_metadata` from real feeds |
| **2. API** | Replace `routes/vs.py` stub with `vs_scans/findings/profiles/dashboard`; delete `scans_db`/`results_db` | dashboard zeros/`4.2`/`87` → SQL aggregates; scans/findings from DB |
| **3. Worker (MVP engine)** | `jobs.vs` consumer + `NucleiScanner` adapter + normalization + `report.vs` Python consumer (idempotent upsert) | findings from **real Nuclei output**, persisted, deduped |
| **4. Scoring + lifecycle** | composite risk (§4) + enrichment join; state machine + history + SLA + dedup/delta; add `NmapNSE`+`Sslyze` adapters | composite risk, severity, MTTR from real history |
| **5. Frontend** | scan config → findings → detail → remediation, wired to `/vs/*` + `useRealtime` | VS.tsx fake tiles → live data |
| **6. Enterprise** | reports (exec/technical PDF), Jira/SIEM hooks, compliance mapping (NIST/ISO/CIS/PCI/SOC2/CERT-In/DPDP), continuous rescan + fleet trends, OpenVAS adapter | reports/compliance from real findings |

**Every placeholder removed:** in-memory `scans_db`/`results_db` (`routes/vs.py`), hardcoded `VSDashboard.tsx` `4.2`d MTTR / `87%` coverage, `avg_mttr_days`/`scan_coverage` defaults, and any `severity` count not backed by a `vs_findings` query. `vs.py:139 TODO: Queue scan job` is implemented by the `jobs.vs` publish in Phase 2/3.

---

## 7. Security decisions register (every flagged item)

1. **Scope authorization** — scans rejected for any asset not `ownership_verified`; `authorized` recorded per target; enforced at API **and** re-checked in the worker (defense in depth).
2. **SSRF / out-of-scope** — `target_guard` at intake + `isForbiddenScanIP` post-DNS in the worker; private/link-local/metadata ranges never scanned.
3. **DoS protection** — per-target token-bucket `max_rps`, `safe_mode` drops intrusive templates, scan-window enforcement, dedicated `jobs.vs` prefetch cap so VS can't starve ASM or hammer a target.
4. **Credential secrecy** — envelope-encrypted at rest (KMS/Fernet, key from secrets-manager), decrypted just-in-time in the worker, zeroized, never logged, access audited.
5. **False-positive minimization** — findings default `confidence=tentative`; a verification/confirmation pass (re-probe) is required to reach `confirmed`; composite risk discounts unconfirmed (`confidence_factor`).
6. **Audit logging** — who scanned what/when/with which profile → `audit_logs`; every lifecycle transition → `vs_finding_history` with actor + justification.
7. **Stored-XSS** — all scanner evidence/blobs pass the recursive sanitizer before persist and are escaped on render/report (same boundary as ASM reporting).
8. **Tenant isolation** — every VS table `org_id`-scoped via `_org_filter`; findings FK to `assets` inherit the org; `vs_cve_metadata` is shared intel with no tenant data.
9. **Provenance** — `vs_scan_runs.engine_versions` + `vs_findings.plugin_id/source_engine` record exactly which engine/template produced each finding (reproducibility, no black box).
```

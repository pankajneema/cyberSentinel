# VS Module — Live Validation Runbook

Everything in the VS module is code-verified, unit-tested, and adversarially
reviewed, but **not executed against real infrastructure** in the build
environment. This runbook is the checklist to prove the end-to-end path
(scan → worker → nuclei → report.vs → persist → UI) on a live stack, plus the
authenticated-scan and CVE-intel paths.

Companion script: `backend/api_service/scripts/vs_smoke_test.sh`.

---

## 1. Prerequisites

### Services
Postgres · Redis · RabbitMQ · `api_service` (FastAPI) · `workers` (Go: consumer +
control-plane + executor) · `reporting` consumer · `frontend`.

### Scanner binaries on the worker image (already used by ASM)
`nuclei` (+ templates), `sslscan`, `nmap`, `naabu`, `subfinder`, `httpx`. Verify:
```bash
for b in nuclei sslscan nmap naabu subfinder httpx; do command -v $b || echo "MISSING: $b"; done
nuclei -version && nuclei -update-templates
```

### Environment (must match across services)
| Var | Where | Purpose |
|---|---|---|
| `CONTROL_PLANE_TOKEN` | api_service **and** workers | Shared secret for the internal credential-materialize channel. **Must be identical.** Fail-closed if unset. |
| `VS_CRED_KEY` | api_service | Fernet key/passphrase encrypting scan credentials at rest. |
| `CORE_API_URL` | workers | Base URL the worker calls for `/api/v1/internal/vs/credential` (e.g. `http://api_service:8000`). |
| `NVD_API_KEY` | api_service | Optional — higher NVD throughput. KEV/EPSS need no key. |
| `VS_CVE_SYNC_HOURS` | api_service | CVE-intel refresh interval (default 20). |

### Migrations
```bash
cd backend/api_service && alembic upgrade head
# expect head = vs_trend_snapshots; VS tables: vs_scans, vs_scan_profiles,
# vs_scan_runs, vs_scan_targets, vs_findings, vs_cve_metadata, vs_finding_history,
# vs_remediation, vs_credentials, vs_trend_snapshots
```

### Queue caveat (same as ASM)
`jobs.vs` and `report.vs` are declared with a dead-letter exchange. If a broker
already has those queues declared WITHOUT DLX args you'll get
`PRECONDITION_FAILED` — delete the pre-existing queues or align the args.

---

## 2. Start order
1. Postgres, Redis, RabbitMQ (healthy).
2. `api_service` — runs migrations check + starts the scheduler (which also fires
   the daily CVE-intel sync and trend snapshots).
3. `workers` — consumer subscribes to **both** `jobs.asm` and `jobs.vs`;
   control-plane + executor up.
4. `reporting` consumer — subscribes to `report.asm` **and** `report.vs`.
5. `frontend`.

Health: `GET /readyz` on api_service should report DB/Redis/RabbitMQ up.

---

## 3. End-to-end smoke test (unauthenticated scan)

> Use a throwaway tenant and a target you own. Get a Supabase access token for an
> owner/admin/analyst user; export `TOKEN` and `BASE=http://localhost:8000/api/v1`.

1. **Asset ready** — confirm the target asset is in inventory and
   `ownership_verified=true` (promote from ASM or add + verify DNS-TXT). VS
   **refuses** to scan unverified assets.
2. **Create profile** — `POST /vs/profiles {name, intensity:"standard", engines:["nuclei"], safe_mode:true}` → 200, returns id.
3. **Create scan** — `POST /vs/scans {name, profile_id, asset_ids:[<verified asset id>], schedule_type:"QUICK"}` → 200.
4. **Run** — `POST /vs/scans/{id}/run` → 200, scan `status=RUNNING`; a `vs_scan_run` (PENDING) + `vs_scan_targets` (authorized=true) created; message on `jobs.vs`.
5. **Worker** — logs show it consumed the `vs` job, ran nuclei against the target, published one `report.vs` message.
6. **Reporting** — logs show `report.vs ingested run=… {new, reappeared, fixed}`.
7. **Run terminal** — `GET /vs/scans/{id}/runs` → the run is `COMPLETED` (or `FAILED` with an error_message — never stuck non-terminal).
8. **Findings** — `GET /vs/findings` → real findings, each with `severity`, `composite_risk`, `risk_factors` ("why"), and `cve_id`+`cvss`/`epss`/`kev` where the template carried a CVE.
9. **Dashboard** — `GET /vs/dashboard` → severity counts, `kev_count`, `scan_coverage>0`, honest `avg_mttr_days`.
10. **Compliance / trends** — `GET /vs/compliance` maps findings to NIST/ISO/CIS/PCI/SOC2/CERT-In controls; `GET /vs/trends` (a snapshot appears after the daily pass or force one).
11. **Report** — `GET /vs/report?report_type=executive&format=pdf` returns a real PDF (`%PDF`).

### Lifecycle + verification
12. `PATCH /vs/findings/{id}/status {status:"confirmed"}` → 200 + a `vs_finding_history` row. Illegal transition → 409. `accepted_risk`/`false_positive` without justification → 400.
13. `POST /vs/findings/{id}/verify` → enqueues a rescan; after it lands, a re-detected finding is `confidence=confirmed`, one not re-detected is auto-`remediated`.

---

## 4. Authenticated scan (credential path)
1. `POST /vs/credentials {name, cred_type:"http_basic", username, secret}` → 200; confirm the response contains **no secret**, and `vs_credentials.secret_ciphertext` is ciphertext (not plaintext).
2. Create a profile with `authenticated:true, credential_id:<id>`; run a scan.
3. Worker log: on the authenticated job it calls `CORE_API_URL/api/v1/internal/vs/credential` with `X-Internal-Token`, gets the credential, and injects `Authorization:` into nuclei. **The secret must not appear in any log** or in the `report.vs` payload.
4. `audit_logs` has a `vs.credential.materialized` row.
5. Negative: wrong/absent `CONTROL_PLANE_TOKEN` → worker logs `[VS][AUTH_UNAVAILABLE]` and the scan proceeds **unauthenticated** (never crashes).

---

## 5. CVE intelligence
- After startup (or force), `vs_cve_metadata` populates from CISA KEV + FIRST EPSS + NVD. Spot-check a known KEV CVE has `kev=true` and an `epss_score`.
- Confirm findings with a `cve_id` get enriched CVSS/EPSS/KEV at ingest.

---

## 6. Non-regression
- ASM discovery still runs end-to-end (the consumer + nuclei wrapper changes were additive).
- `GET /readyz` deep check still green; existing ASM/auth endpoints unaffected.

---

## 7. Rollback
- `alembic downgrade -1` reverses each VS migration (`vs_trend_snapshots` → `vs_module`).
- Un-mount VS by removing the `vs`/`internal_vs` routers in `main.py` (data preserved).

# ASM Module — Evaluation & Build Plan (pre-Phase-4)

Inspection of the actual code (June 2026). This is the go-forward plan to take
ASM from its current state to a defensible, industry-grade module.

## Verdict & maturity

**ASM is the real product — ~60–65% of a credible EASM, but with reliability and
scoring gaps that block "enterprise-grade."** The discovery breadth and data model
are strong; the engine's robustness and the risk model are weak.

| Dimension | Score | Note |
|---|---|---|
| Discovery breadth | 7.5/10 | 15 real tools, 13 data types |
| Data model | 7/10 | 13 tables, now org-scoped |
| API surface | 7/10 | 25 endpoints, all data types served |
| Frontend coverage | 7/10 | 18 components, real views |
| **Engine reliability** | **3/10** | in-memory state, no resume, lost on crash |
| **Risk scoring** | **2/10** | magic-number heuristic, indefensible |
| Feature parity (vs leaders) | 4/10 | missing screenshots, fingerprinting, ownership |
| Continuous monitoring | 3/10 | schedule fields exist, scheduler unproven |
| **Composite ASM** | **~5.5/10** | strong core, weak hardening |

---

## What's already built (inventory)

**Discovery engine — 15 real recon tools (Go):** subfinder, amass, crtsh, dnsx,
dnsgen, naabu, nmap, nuclei, httpx, httpprobe, katana, gobuster, sslscan, bbot,
cloudenum. Pipeline defines 40+ stages.

**Data model — 13 tables:** discoveries, discovery_runs, subdomains, ips, ports,
services, ssl_certs, api_endpoints, cloud_resources, admin_endpoints,
backup_files, changes, settings. (All now carry `org_id` / scope correctly.)

**API — 25 endpoints:** discoveries CRUD, dashboard + overview, subdomains, ips,
ips/geo-map, ports, services, ssl, api-endpoints, cloud-resources,
admin-endpoints, backup-files, changes, runs.

**Frontend — 18 components:** ASMOverview, ASMFindings, AssetInventory,
AttackSurfaceGraph, CloudAttackSurface, DiscoveryManager, DiscoveryRunsList,
IPDiscovery, IPGeoMap, SubdomainDiscovery, Vulnerabilities, RiskGauge,
HumanAttackSurface, ASMReports, ASMSettings, EmptyState, SeverityBadge, StatCard.

**Recently fixed:** org-based tenant scoping (data now shows + isolated), role
RBAC on writes, no-shell nmap, job timeout + top-level panic recovery.

---

## Critical gaps (must fix for enterprise-grade)

### 1. Engine reliability — the #1 risk (score 3/10)
- **In-memory job registry** (`map[string]*Job` in `job_manager.go`) — job state is
  per-process, lost on restart, not shareable across replicas. Cannot scale.
- **No resume/checkpoint** (confirmed: 0 in `task.go`) — a crash mid-scan loses the
  whole job; it re-runs from scratch or is stranded at RUNNING forever.
- **Per-step panic recovery missing** — only a top-level recover exists; one bad
  parser aborts the whole job.
- **Detached goroutine breaks the queue contract** — message ACKed before the scan
  runs, so a crash silently drops paid work.

### 2. Risk scoring — indefensible (score 2/10)
- Exposure score is `len(ipPorts) * 3 + 12/sensitive-port` (`ip.go:490`). No CVSS,
  no EPSS, no exploitability, no asset criticality. A customer-facing "exposure
  score" built on magic numbers fails any enterprise audit.

### 3. Stub stages reporting COMPLETED
- Several pipeline stages (diff engine, relationship map, deep TLS) mark COMPLETED
  with empty/fabricated output — inflates reports with work never performed.

---

## Missing features vs EASM leaders (Defender EASM / Xpanse / Censys)

| Capability | Status | Priority |
|---|---|---|
| **Screenshots / visual recon** (gowitness) | absent | high |
| **Technology fingerprinting** (wappalyzer-style) | absent | high |
| **Ownership verification** (DNS-TXT before scanning) | absent | high (safety) |
| **Certificate expiry alerting** | inventory only | medium |
| **Change/delta operationalized** (diff + alerts) | table exists, stub | medium |
| **Continuous monitoring scheduler** at scale | fields exist, unproven | medium |
| **Asset relationship graph API** | client-derived only | low |
| **Cloud discovery depth** (provider creds) | thin (cloudenum) | medium |

---

## Improvements to existing pieces
- Replace magic-number scoring with a documented, configurable CVSS/EPSS + asset-
  criticality model; expose the "why" in the UI.
- Persist job state in Postgres/Redis; remove the in-memory map; ACK after success.
- Validate scan targets (block private/metadata ranges) — SSRF hardening for the
  domain pipeline (IP path already validated).
- Pin every scanner version + checksum (supply chain); SBOM.
- Kill N+1 queries in reporting (`domain.py`) for scale.
- Make stub stages emit SKIPPED, not COMPLETED.

## New things to build
- gowitness screenshot capture + storage + UI gallery
- tech/version fingerprinting stage + UI
- ownership-verification flow (prove a domain before external scans)
- cert-expiry + new-exposure alerting pipeline
- real continuous-monitoring scheduler (interval/cron) with backpressure

---

## Prioritized build plan (to ASM 10/10)

**Sprint 1 — Reliability (make the engine trustworthy)**
1. Move job state to Postgres/Redis; remove in-memory map.
2. ACK-after-success + per-step checkpoint + resume.
3. Per-step panic recovery; stale-RUNNING reaper.
4. RabbitMQ DLQ already added — wire retry limits.

**Sprint 2 — Defensible risk + data integrity**
5. CVSS/EPSS + asset-criticality scoring model (configurable, explainable).
6. Mark stub stages SKIPPED; remove fabricated output.
7. Target validation / SSRF hardening on the domain pipeline.

**Sprint 3 — Feature parity**
8. Screenshots (gowitness) + UI gallery.
9. Technology fingerprinting + UI.
10. Ownership verification before external scans.

**Sprint 4 — Monitoring & scale**
11. Real continuous-monitoring scheduler.
12. Cert-expiry + change/new-exposure alerting.
13. Reporting performance (batch queries, partition/archival) for 100k+ assets.

**Exit (ASM 10/10):** onboard domain → prove ownership → discover (subdomains/IPs/
ports/services/certs/screenshots/tech) → defensible exposure score → change &
cert alerts → promote findings to tracked assets → scheduled continuous monitoring;
crash-safe, cancellable, scaling to 100k+ assets, no critical/high security
findings in the ASM path.

---

## Recommended starting point
**Sprint 1, item 1–3 (engine reliability).** It's the lowest score (3/10), the
biggest enterprise risk, and everything else (scoring, features) is wasted on an
engine that loses jobs. Start by moving job state out of memory and making scans
crash-safe and resumable.

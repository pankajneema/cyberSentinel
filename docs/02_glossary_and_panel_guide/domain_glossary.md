# Domain Glossary `[Module: Core-Platform + ASM]`

> Every security, ASM, infrastructure, cloud, and platform term used in CyberSentinel — defined twice: once in **plain English** (a non-technical person understands it) and once **technically** (a developer knows exactly what it maps to in the system). Where a term maps to a database column or code path, that's noted.

**Related:** [Panel Guide](panel_guide.md) · [Inventory](../00_inventory.md) · [Developer Guide](../01_developer_guide/overview.md) · [Database](../05_database_guide.md)

Jump to: [Security & ASM terms](#security--asm-terms) · [Scoring terms](#scoring--exposure-terms) · [Asset & discovery terms](#asset--discovery-terms) · [Platform terms](#platform--tenancy-terms) · [Infra & DevOps terms](#infrastructure--devops-terms) · [Acronyms](#acronym-quick-reference)

---

## Security & ASM terms

### Attack Surface
- **Plain:** Everything about your organization that someone on the internet could potentially find and attack — websites, servers, cloud buckets, exposed logins, leaked accounts.
- **Technical:** The union of all discovered `assets` and `asm_*` findings for an org. Summarized as the **Attack Surface Index** on the ASM Overview.
- **Where seen:** ASM → Overview, Graph. **Business impact:** the bigger and less-monitored it is, the more ways in for an attacker.

### Attack Surface Management (ASM)
- **Plain:** Continuously finding and keeping track of everything you expose to the internet, so nothing is forgotten and unguarded.
- **Technical:** The live module — `asm.py` router + Go scan pipeline + reporting consumer. Asset types: domain, IP, cloud, repo, saas, user.
- **Where seen:** the ASM section. **Related:** [Exposure](#exposure), [Discovery](#discovery).

### Exposure
- **Plain:** How reachable and risky an asset is from the outside — an open database port is far more "exposed" than an internal-only service.
- **Technical:** A per-asset 0–100 score from `scoring/exposure.py` (and the worker's per-IP `exposure_scoring` step) with a severity band and a per-factor breakdown. Stored on `asm_ips.exposure_score`/`exposure_level`/`score_explanation` and `assets.risk_score`.
- **Where seen:** ASM → Exposure, Overview, Findings→IPs. **Related:** [Severity](#severity), [Sensitive port](#sensitive-port).

### Discovery
- **Plain:** A single "go find things" job you set up — e.g. "scan all of `*.company.com` every day."
- **Technical:** An `asm_discoveries` row: `asset_type`, `target_source` (FROM_ASSET/MANUAL_ENTRY), `intensity` (LIGHT/NORMAL/DEEP), `schedule_type` (QUICK/INTERVAL/CRON), `status`. Each execution is an `asm_discovery_run`.
- **Where seen:** ASM → Discovery. **Related:** [Intensity](#intensity), [Run](#run).

### Intensity
- **Plain:** How deep a scan digs — Light (quick), Normal (recommended), or Deep (thorough, slower).
- **Technical:** Enum `LIGHT|NORMAL|DEEP`; combined with `asset_type` by the worker's `GeneratePipeline` to decide which scan steps run.

### Sensitive port
- **Plain:** A network "door" that's especially dangerous to leave open to the internet — remote desktop, databases, file sharing.
- **Technical:** Entry in `SENSITIVE_PORTS` (e.g. 23 Telnet, 3389 RDP, 3306/5432/27017 DBs, 6379 Redis, 445 SMB, 2375 Docker). Adds extra exposure points.
- **Where seen:** ASM → Findings→Ports, Exposure "why this score." **Business impact:** an open sensitive port is one of the fastest paths to compromise.

### SSL / TLS
- **Plain:** The lock icon in your browser — encryption for a site. "TLS issues" mean the encryption is weak, expired, or misconfigured.
- **Technical:** `asm_ssl_certs` (host, port, protocol, issuer, validity). TLS issues add exposure points.
- **Where seen:** ASM → Findings→SSL/TLS.

### Secret / Leak (repo finding)
- **Plain:** A password, API key, or token accidentally left in source code where anyone can read it.
- **Technical:** `asm_repo_findings` (repo_url, finding_type, rule, file_path:line, severity) from the worker's `repo_secret_scan` (gitleaks). Severity passes through verbatim.
- **Where seen:** ASM → Repo Findings.

### Breached account / User exposure
- **Plain:** An employee email that has shown up in a known data breach — meaning its password may be public.
- **Technical:** `asm_user_accounts` (email, source, breached, breach_count, exposed_data, severity) from the worker's `email_leak_check`.
- **Where seen:** ASM → User Exposure.

### SaaS app (shadow IT)
- **Plain:** A third-party online tool your company uses (or someone signed up for) — Slack, a random survey tool, etc. — that may not be officially tracked.
- **Technical:** `asm_saas_apps` (application, vendor, category, url, discovery method, status) from `saas_detect`.
- **Where seen:** ASM → SaaS Apps.

### CVE / CVSS / EPSS / KEV
- **Plain:** Standard ways to name and rank known software vulnerabilities. **CVE** = the vulnerability's ID. **CVSS** = how severe it is (0–10). **EPSS** = how likely it is to be exploited soon. **KEV** = it's on a list of bugs known to be actively exploited right now.
- **Technical:** Inputs to the exposure model's CVE branch (`scoring/exposure.py`): worst CVSS/10×30, EPSS boost ×20, KEV flat +25. **Currently dead in production** — no CVE persistence feeds it yet (see [inventory §7 #5](../00_inventory.md#7-open-questions--confirmation-needed)).
- **Where seen:** Exposure panel header vocabulary; VS module (CVE-oriented, in-memory).

### MITRE ATT&CK
- **Plain:** A widely-used catalog of the tactics and techniques attackers use.
- **Technical:** Referenced in the marketing Services copy; not yet a data model in ASM. `[NEEDS CONFIRMATION FROM DEV]`

### SSRF (Server-Side Request Forgery)
- **Plain:** A trick where an attacker makes *your* server fetch something it shouldn't — like your cloud's internal admin API.
- **Technical:** Defended in two layers — intake guard (`utils/target_guard.py`) rejects private/reserved literals; the Go worker (`executor/runner/ip.go`) applies the authoritative filter after DNS resolution (anti-rebinding).

---

## Scoring & exposure terms

### Attack Surface Index
- **Plain:** A single headline number summarizing how exposed your whole org is.
- **Technical:** `attack_surface_score` on `/asm/dashboard` — average `risk_score` across the org's assets. Rendered by the `RiskGauge`.

### Severity
- **Plain:** How bad a finding is: Critical, High, Medium, Low, or Info.
- **Technical:** Band derived from the 0–100 score via `SEVERITY_BANDS` (≥80 critical, ≥60 high, ≥40 medium, ≥20 low, else info). UI `SeverityBadge` colors: critical=destructive(red), high=warning(orange), medium=accent(amber), low=success(green), info=muted.

### Score explanation ("Why this score")
- **Plain:** A plain list of exactly what pushed a score up — "open RDP port +12," "expired certificate +5."
- **Technical:** `ScoreFactor[]` from `scoring/exposure.py`, stored in `asm_ips.score_explanation`; rendered as the expandable row on the Exposure panel. This is the platform's **explainability** guarantee.

### Exposure weights
- **Plain:** How much each kind of risk counts toward the score — configurable per org.
- **Technical:** `DEFAULT_WEIGHTS` in `scoring/exposure.py`, tunable via ASM → Settings → Exposure Scoring (Internet-facing 30%, Ports/services 25%, SSL/TLS 15%, Cloud 15%, Admin/backup 10%, API 5%).

---

## Asset & discovery terms

| Term | Plain | Technical (maps to) |
|---|---|---|
| **Asset** | A thing you own/expose (domain, IP, cloud resource, repo, SaaS, user) | `assets` table; `type` ∈ domain/ip/cloud/repo/saas/user |
| **Domain / Subdomain** | A website name / a sub-address under it (`app.company.com`) | `asm_subdomains` |
| **IP / Host** | The numeric address of a machine on the internet | `asm_ips` (+ geo/ASN/RDAP attribution) |
| **Port** | A numbered "door" on a machine where a service listens | `asm_ports` (ip, port, protocol, service, status) |
| **Service** | The software answering on a port (e.g. nginx 1.24) | `asm_services` (service, version, product) |
| **Cloud resource** | An asset in a cloud account (S3 bucket, VM) | `asm_cloud_resources` (provider, type, resource, access, region) |
| **API endpoint** | A programmatic URL a system exposes | `asm_api_endpoints` (url, method, status, type) |
| **Admin endpoint** | A login/management page (e.g. `/admin`) | `asm_admin_endpoints` |
| **Backup file** | A leftover backup/config file exposed on the web | `asm_backup_files` (url, extension, status) |
| **Change** | A difference detected between two scans | `asm_changes` (message, change count) |
| **Run** | One execution of a discovery | `asm_discovery_runs` (status, triggered_by, summary, intensity, duration) |
| **Ownership verification** | Proving you own an asset before scanning it | `assets.ownership_verified`/`verification_token`; domains via DNS TXT, others via attestation |
| **Unscanned** | Asset that has never been scored (distinct from score 0) | `assets.risk_score IS NULL` |

### ASN / RDAP / Geo
- **Plain:** Who owns an IP address and roughly where it is. **ASN** = the network operator; **RDAP/WHOIS** = ownership records; **Geo** = country/city.
- **Technical:** Enrichment on `asm_ips` from `ip-api.com` (geo/ASN/ISP) and `rdap.org` (owner/country). Powers the Geo Map.

---

## Platform & tenancy terms

| Term | Plain | Technical |
|---|---|---|
| **Organization (Org / Tenant)** | Your company's isolated workspace | `organizations`; the tenant root. Every table has `org_id` |
| **Member** | A person in your org | `member_profiles` (role, is_active) |
| **Role** | What a member can do | `owner > admin > analyst > reader` |
| **Owner** | The org's top authority (created on first login) | `organizations.owner_user_id`; never assignable via invite |
| **Invite** | An emailed link to join an org | `org_invites` (single-use, 72h TTL) |
| **Audit log** | An append-only record of who did what | `audit_logs` |
| **RBAC** | Permission tiers by role | `require_role(...)`; writers = owner/admin/analyst |
| **Supabase** | The service that handles login | External identity provider; issues JWTs |
| **JWT** | A signed token proving who you are | Verified server-side, algorithms pinned |
| **JIT provisioning** | Auto-creating your org/profile on first login | `utils/identity_sync.sync_profile_and_org` |

---

## Infrastructure & DevOps terms

| Term | Plain | Technical |
|---|---|---|
| **Queue / Broker** | A to-do list services hand work through | RabbitMQ; `jobs.asm`, `report.asm` |
| **Worker** | A background program that does heavy work | Go `consumer` + `control-plane` |
| **Consumer** | A worker that pulls jobs off a queue | `consumer/start.go` |
| **Control-plane** | The brain that orchestrates + runs scans | Go Gin server |
| **Pipeline** | The ordered list of scan steps for a job | `asm:pipeline:{id}` in Redis |
| **Pub/Sub** | Broadcast messaging (one publishes, many hear) | Redis `rt:events`, `asm:worker:events` |
| **Cache / Redis** | Fast temporary memory | rate limits, pipeline state, dedup |
| **Scheduler** | The timer that re-runs due scans | `utils/scheduler.py` |
| **Rate limit** | A cap on requests to prevent abuse | Redis fixed-window; fail-open |
| **DLQ (Dead-letter queue)** | Where failed messages go instead of looping | RabbitMQ `Nack(requeue=false)` |
| **CORS** | Rules on which sites may call the API | explicit allow-list, never `*` |
| **Migration / Alembic** | Versioned database schema changes | `migrations/`; owns prod DDL |
| **Observability** | Logs, metrics, traces to see what's happening | logging + `/metrics` + optional Sentry/OTel |

---

## Acronym quick reference

| Acronym | Expansion |
|---|---|
| ASM | Attack Surface Management |
| VS | Vulnerability Scanning |
| CVE | Common Vulnerabilities and Exposures |
| CVSS | Common Vulnerability Scoring System |
| EPSS | Exploit Prediction Scoring System |
| KEV | Known Exploited Vulnerabilities (CISA catalog) |
| CWE | Common Weakness Enumeration |
| IOC | Indicator of Compromise |
| TTP | Tactics, Techniques, and Procedures |
| SSRF | Server-Side Request Forgery |
| IDOR | Insecure Direct Object Reference |
| RBAC | Role-Based Access Control |
| JWT | JSON Web Token |
| ASN | Autonomous System Number |
| RDAP | Registration Data Access Protocol |
| TLS/SSL | Transport Layer Security / Secure Sockets Layer |
| DLQ | Dead-Letter Queue |
| MTTR | Mean Time To Remediate |
| RDP | Remote Desktop Protocol |
| SMB | Server Message Block |
| OSINT | Open-Source Intelligence |

*A term missing? Add it here and link it from wherever it appears — the glossary should cover every piece of jargon a reader can encounter.*

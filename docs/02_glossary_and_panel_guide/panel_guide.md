# Panel-by-Panel Guide `[Module: ASM]`

> Every major screen in the product, explained so a non-technical person AND a developer understand it: what the panel shows, why it exists, and — for every field — **what it means and where the data comes from** (which API → which service → which DB table). Terms link to the [Glossary](domain_glossary.md).

**Related:** [Glossary](domain_glossary.md) · [Frontend](../01_developer_guide/frontend.md) · [API Guide](../04_infra_and_api_guide/api_guide.md)

Organized by **Category** (module) so new modules append cleanly: `Category: ASM`, then app-wide screens.

---

## Category: ASM

The ASM workspace (`pages/app/ASM.tsx`) is a tabbed page. Tabs: **Overview · Findings · Repo Findings · SaaS Apps · User Exposure · Exposure · Discovery · Reports · Graph · Geo Map · Settings**. The active tab is saved in the URL (`?tab=`).

### Panel: Overview
*Component `ASMOverview.tsx` · data from `GET /asm/dashboard/overview`.*
The at-a-glance health screen. Why it exists: give a security lead a 5-second read on "how exposed are we, and what changed."

| Field / widget | What it means | Data source |
|---|---|---|
| **Attack Surface Index** (KPI + RiskGauge) | Headline exposure number for the whole org | avg `assets.risk_score`; gauge thresholds ≥80 Critical/≥60 High/≥40 Medium |
| **Total Assets / Public Assets** | How many assets exist / how many face the internet | `assets` counts |
| **Active Discoveries** | Scans currently configured/running | `asm_discoveries` |
| **Last Run** | When the most recent scan finished | `asm_discovery_runs` |
| **Asset Landscape** | Counts of Domains, Subdomains, IPs, Cloud, Services | `asm_*` counts |
| **Exposure Summary** | Public / Internet-facing / Unknown-ownership counts | derived |
| **Exposure Health** | Gauge + High/Medium/Low exposure counts | exposure bands |
| **Exposure Trend** | Bar chart of exposure over time | `exposure_history` if present — else **honest empty state** ("Trend appears after repeated scans"); backend doesn't persist snapshots yet |
| **Top Exposed Assets** | Worst assets with a colored score badge | top-N by exposure |
| **Recent Activity** | Latest actions (alert/success/info) | `audit_logs` |

### Panel: Findings
*Component `ASMFindings.tsx`.* Sub-tabbed data tables of everything discovered. Every table supports search, sort, pagination (10/20/50/100) and **client-side CSV export**. Empty state: "Run a Deep discovery or enable this detector to populate this view."

| Sub-tab | Columns | Source table | API |
|---|---|---|---|
| **Subdomains** | Subdomain, DNS status, IP count, parent asset | `asm_subdomains` | `/asm/subdomains` |
| **IPs** | IP, Subdomain, Status, Reachable, Exposure, Open Ports (+ "Rescore") | `asm_ips` | `/asm/ips` |
| **Cloud** | Provider, Type, Resource, Access, Region | `asm_cloud_resources` | `/asm/cloud-resources` |
| **Ports** | IP, Port, Protocol, Service, Status | `asm_ports` | `/asm/ports` |
| **Services** | IP, Port, Service, Version/Product | `asm_services` | `/asm/services` |
| **SSL/TLS** | Host, Port, Protocol, Issuer | `asm_ssl_certs` | `/asm/ssl` |
| **APIs** | URL, Method, Status, Type | `asm_api_endpoints` | `/asm/api-endpoints` |
| **Admin** | URL, Status, Type | `asm_admin_endpoints` | `/asm/admin-endpoints` |
| **Backup** | URL, Extension, Status | `asm_backup_files` | `/asm/backup-files` |
| **Changes** | Message, Changes (count) | `asm_changes` | `/asm/changes` |

### Panel: Repo Findings / SaaS Apps / User Exposure
*Component `ExtendedFindings.tsx`.*

| Panel | Columns | Meaning | Source |
|---|---|---|---|
| **Repository Findings** | Repository, Type, Rule, Location (file:line), **Severity** | Secrets/leaks/risky patterns in discovered repos | `asm_repo_findings` ← `repo_secret_scan` |
| **SaaS Applications** | Application, Vendor, Category, URL, Discovery, Status | Third-party SaaS on your attack surface | `asm_saas_apps` ← `saas_detect` |
| **User Exposure** | Email, Source, **Breached** (Y/N), Breaches (count), Exposed Data, Severity | Employee/service accounts in breaches | `asm_user_accounts` ← `email_leak_check` |

### Panel: Exposure
*Component `ExposureSignals.tsx` · data from `GET /asm/exposure`.* The explainable per-asset scoring view. Header states the model: *"Defensible per-asset exposure scoring — open ports & sensitive services, TLS posture, and known vulnerabilities (CVSS · EPSS · KEV). Every point is explained."*
- **Severity summary row:** counts of critical / high / medium / low / info.
- **Table:** IP, Location/ASN, Open ports, **Exposure** (score bar + 0–100 + severity pill). Bar colors: ≥80 red, ≥60 orange, ≥40 amber, ≥20 sky.
- **"Why this score"** (expandable per row): the `ScoreFactor` breakdown — each `+points` and its reason. → [Score explanation](domain_glossary.md#score-explanation-why-this-score).

### Panel: Discovery
*Component `DiscoveryManager.tsx` (`ScanManager`).* Create and manage scan jobs. Status filter tabs (All/Active/Running/Paused/Pending/Completed/Failed) + stat tiles. Each discovery card: status icon, name, `asset_type • intensity`, schedule, last/next run, actions (View, Edit, Pause/Activate, Delete; View Logs when running).

**New Discovery wizard (3 steps):**
1. **Asset Type:** Domain, IP, Cloud, Repository, SaaS, User Account.
2. **Configure Target:** name; source **From Asset Inventory** (multi-select) or **Manual Entry** (type-specific placeholders, e.g. CIDR `192.168.1.0/24`, `*.company.com`, `arn:aws:s3:::mybucket`); **Intensity** Light/Normal/Deep.
3. **Schedule:** Quick (once), Interval (Hourly/5h/12h/Daily/Weekly/Monthly), or Custom CRON; email-notification toggle; summary.

Payload enums: `asset_type` domain|ip|cloud|repo|saas|user; `target_source` FROM_ASSET|MANUAL_ENTRY; `intensity` LIGHT|NORMAL|DEEP; `schedule_type` QUICK|INTERVAL|CRON.
> ⚠️ "Run Now"/"Stop" actions are currently commented out; "Stop" maps to a PATCH→PAUSED. Progress bars on running cards are hardcoded animations, not real progress. See [frontend tech debt](../01_developer_guide/frontend.md#11-known-limitations--tech-debt).

### Panel: Reports (ASM tab)
*Component `DiscoveryRunsList.tsx`.* Table of discovery runs: Discovery, Run Date, Triggered By, Status, Summary, Intensity, Duration. Searchable by discovery name or run ID. Source: `asm_discovery_runs`. (The full report-generation UI is the app-wide **Reports** page.)

### Panel: Graph
*Component `AttackSurfaceGraph.tsx`.* Relationship visualization across assets/discoveries, with "Select Asset Type" and "Select Domain" selectors. Shows how domains → subdomains → IPs → services connect.

### Panel: Geo Map
*Component `IPGeoMap.tsx` · data from `GET /asm/ips/geo-map`.* Interactive world map (react-simple-maps). Discovered IPs plotted as clustered cyan markers (2° grid). Click a marker → IP detail (Host, Country, City, ASN, Org); otherwise a Countries breakdown. Footer: Total IPs, Marker clusters. Honest empty state when no geolocated IPs.
> ⚠️ World-atlas topojson is fetched from `cdn.jsdelivr.net` at runtime (external dependency — air-gap concern).

### Panel: Settings (ASM)
*Component `ASMSettings.tsx` · `GET/PUT /asm/settings`.* Five sub-tabs with a dirty-tracking Save:
- **Exposure Scoring:** Critical/High/Medium threshold sliders (default 80/60/40) with live band preview; weighting display (Internet-facing 30%, Ports 25%, SSL/TLS 15%, Cloud 15%, Admin/backup 10%, API 5%).
- **Notifications:** toggles (high/medium exposure, new assets, discovery completed, daily summary, weekly report) + channels (Email recipients, Slack webhook, Teams webhook).
- **Automation:** auto-create Jira tickets, auto-assign assets, auto-verify exposure changes, auto-archive stale (>30d).
- **Suppression:** rules with pattern (`*.example.com` or `CVE-XXXX-XXXXX`), reason, expiration.
- **Asset Grouping:** pattern → group + tags (e.g. `*.prod.*` → Production).

> These settings drive real behavior: the thresholds feed severity bands; the notification toggles gate the [notification service](../01_developer_guide/notificationservice.md)'s outbound channels via `RULE_FOR_EVENT`.

---

## Category: App-wide screens

### Panel: Dashboard
*`pages/app/Dashboard.tsx`.* Cross-module security overview — pulls `fetchAsmOverview`, `fetchVsDashboard`, `fetchAssets`. Shows an "Immediate Attention" banner, discovery summary (domains monitored), top assets, and recent alerts.

### Panel: Asset Inventory
*`Assets` → `AssetInventory`.* The canonical asset list (`assets` table). Create/import (bulk CSV), filter by type/exposure, rescore, and verify ownership before scanning. Backed by the reference-secure `assets.py` router.

### Panel: Vulnerability Scans (VS)
*`pages/app/VS.tsx`.* CVE-oriented scanning module — tabs Dashboard, Scan Manager, Findings, Asset View, Remediation, Settings. **Interim: in-memory only** (process dicts, lost on restart); MTTR/coverage honestly show 0. Marketing marks it "coming soon."

### Panel: Team Management
*`pages/app/Team.tsx`.* Members, invites, and task assignment/messaging. Backed by `orgs.py` (members/invites) and `tasks.py` (task threads).

### Panel: Reports
*`pages/app/Reports.tsx`.* Generate/schedule/download reports (PDF/CSV/JSON) built from **real tenant data** — vulnerabilities section honestly reports 0 (no persisted VS store). Backed by `reports.py`.

### Panel: Marketplace
*`pages/app/Marketplace.tsx`.* Integration catalog (Slack, Jira, Teams, ServiceNow, PagerDuty, Splunk, AWS Security Hub). **Preview only** — "Install" toasts "Coming soon"; no backend.

### Panel: Services
*`pages/app/Services.tsx`.* Module catalog — ASM `available`; VS, Breach & Attack Simulation, Threat Intelligence, Incident Response, Compliance & Audit `coming-soon`. Backed by `services.py` (purchase = 501).

### Panel: Account / Profile / Settings
*`Account`, `Profile`, `Settings`.* Profile fields, security, notifications, theme, sessions, billing tabs. Backed by `auth_supabase.py` (`/me`, `/profile`, `/settings`) and `billing.py`.

### Global overlays
- **LiveScanPopup** (`components/app/LiveScanPopup.tsx`): floating cards driven by the realtime stream — appear on `scan.started` (keyed by `discovery_id`), disappear on terminal events. Icon = Radar (ASM) / Bug (VS).
- **LiveScanIndicator:** compact live-scan status in the shell.

---

## How to add a new module's panels
Add a new `## Category: <Module>` section here (never edit the ASM category), mirroring the same "panel → fields → data source" table shape. Add any new terms to the [Glossary](domain_glossary.md). See [README → How to extend](../README.md#how-to-extend-these-docs-adding-a-new-module).

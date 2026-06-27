# CyberSentinel — The Complete Guide to ASM (Attack Surface Management)

> **Who is this for?** Anyone. You do **not** need a cybersecurity background.
> If you can understand "a house has doors and windows, and some of them are
> unlocked," you can understand this whole document. We start from zero, explain
> every word, and then walk through exactly how CyberSentinel's ASM works —
> end to end, button to database to back again.

---

## Table of contents

1. [The big idea in one minute](#1-the-big-idea-in-one-minute)
2. [Plain-English vocabulary](#2-plain-english-vocabulary)
3. [What is an "asset"? (the 6 types)](#3-what-is-an-asset-the-6-types)
4. [What is a "Discovery"? (the explore job)](#4-what-is-a-discovery-the-explore-job)
5. [Intensity: Light, Normal, Deep](#5-intensity-light-normal-deep)
6. [Scheduling: Quick, Interval, Cron](#6-scheduling-quick-interval-cron)
7. [The discovery pipeline — what actually runs](#7-the-discovery-pipeline--what-actually-runs)
8. [What we find (the result categories)](#8-what-we-find-the-result-categories)
9. [The Exposure / Risk Score — how a number gets decided](#9-the-exposure--risk-score--how-a-number-gets-decided)
10. [The screens in CyberSentinel (component by component)](#10-the-screens-in-cybersentinel-component-by-component)
11. [The architecture — how data flows through the system](#11-the-architecture--how-data-flows-through-the-system)
12. [A full real-life walkthrough](#12-a-full-real-life-walkthrough)
13. [Honesty section: what exists in the code but isn't fully wired](#13-honesty-section-what-exists-in-the-code-but-isnt-fully-wired)
14. [Glossary](#14-glossary)

---

## 1. The big idea in one minute

Imagine your company is a **huge building** with hundreds of doors, windows,
side-entrances, and even some doors you forgot you built. **Attackers** (the bad
guys on the internet) walk around the outside of your building trying every door
to see which ones are unlocked.

**Attack Surface Management (ASM)** is the practice of doing what the attacker
does — but *first, and on your own side* — so you can find the unlocked doors
and lock them before someone walks in.

Your "building from the outside" is called your **attack surface**: every
website, server, IP address, cloud bucket, login page, and forgotten test server
that the public internet can reach.

CyberSentinel's ASM module automatically:

1. **Finds** everything you own that's facing the internet (even things you
   forgot about). This is called **Discovery**.
2. **Inspects** each thing — which ports are open, what software is running, is
   the encryption healthy, are there admin panels or leaked backups.
3. **Scores** how risky each thing is (a number from **0 to 100**) and explains
   *why*.
4. **Shows** it all to you on clear dashboards, maps, and tables, and tells you
   when something **changes**.

That's it. Everything below is just the detail of how each step works.

---

## 2. Plain-English vocabulary

You'll see these words everywhere. Here they are in everyday language:

| Term | Everyday meaning |
|---|---|
| **Asset** | One thing you own that's online — a website, a server, an IP, a cloud bucket, etc. (Think: one "door" on your building.) |
| **Attack surface** | *All* your assets added together — the whole outside of your building. |
| **Exposure** | How visible/reachable something is from the public internet. "Public" = anyone can reach it. "Internal" = only people inside your network. |
| **Discovery / Explore** | The act of going out and *finding* assets and details about them. A single discovery run is like sending a scout around the building. |
| **Subdomain** | A "sub-address" of your main website. If `company.com` is your house, then `mail.company.com`, `vpn.company.com`, `test.company.com` are rooms with their own outside doors. |
| **IP address** | The actual numeric "street address" of a server on the internet (e.g., `93.184.216.34`). Domains are friendly names that point to IPs. |
| **Port** | A numbered "door" on a server. Port 443 = the normal HTTPS website door. Port 3306 = a MySQL database door (should usually NOT be open to the public!). |
| **Service** | The software answering behind a port (e.g., "nginx web server", "OpenSSH", "MySQL 5.7"). |
| **SSL/TLS certificate** | The little padlock 🔒 that proves a site is encrypted and who it belongs to. It can expire, be fake (self-signed), or be misconfigured. |
| **CVE** | A publicly known software vulnerability (a named weakness), like `CVE-2021-44228`. Think of it as a recorded "this lock model is pickable." |
| **CVSS** | A 0–10 severity rating for how bad a CVE is. 10 = catastrophic. |
| **EPSS** | A 0–100% prediction of how *likely* a CVE is to actually be attacked soon. |
| **KEV** | "Known Exploited Vulnerability" — a government (CISA) list of CVEs that are being actively used by attackers *right now*. The scariest bucket. |
| **Exposure / Risk score** | CyberSentinel's 0–100 grade for how dangerous an asset's current state is. Higher = worse. |
| **Pipeline** | The fixed sequence of steps a discovery runs through (find → resolve → scan → inspect → score). |
| **Org (organization / tenant)** | Your company's private space in the app. One org can **never** see another org's data. This is called *tenant isolation*. |

---

## 3. What is an "asset"? (the 6 types)

An **asset** is one thing you own and want to watch. In CyberSentinel an asset
has a **type**. There are **six** types:

| Type | What it is | Real example |
|---|---|---|
| **domain** | A website / domain name | `company.com` |
| **ip** | A single server's numeric address | `93.184.216.34` |
| **cloud** | A cloud resource (AWS/Azure/GCP) | an S3 storage bucket |
| **repo** | A code repository | a GitHub repo |
| **saas** | A third-party SaaS app you use | a Slack or Salesforce workspace |
| **user** | A human identity / account | an employee's work email |

Each asset also stores:

- **exposure**: `public` (internet-facing) or `internal`.
- **tags**: free labels you add (e.g., `production`, `aws`, `finance`).
- **risk_score**: the 0–100 grade — or **"Unscanned"** if we've never measured it
  yet. (Important: *Unscanned* is different from *score 0*. Unscanned = "we don't
  know yet." Score 0 = "we checked and it looks clean.")
- **description**: an optional note.

You add assets on the **Asset Inventory** screen — one at a time, in bulk (paste
a list), or by uploading a CSV file. You can also discover *new* assets you
didn't know about, which brings us to the next concept.

---

## 4. What is a "Discovery"? (the explore job)

A **Discovery** is a saved "exploration job." You tell CyberSentinel:

- **What to look at** — either pick existing assets (*"FROM_ASSET"*) or type
  targets in by hand (*"MANUAL_ENTRY"*, e.g. paste `company.com`).
- **What asset type** it is — `domain`, `ip`, or `cloud` (these three are the
  ones the discovery engine currently runs).
- **How hard to look** — the **intensity** (Light / Normal / Deep). More on this
  next.
- **When/how often to run** — the **schedule** (Quick / Interval / Cron).

Once created, the discovery gets **queued** and a fleet of background "worker"
programs actually go out and do the scanning. You can **Run / Re-run**, **Pause**,
or **Delete** a discovery at any time, and you can see its **run history** (every
time it executed, how long it took, and whether it succeeded).

> **Analogy:** A Discovery is like a *standing instruction to a security guard*:
> "Every night, walk around the `company.com` building, try all the doors at
> *Normal* thoroughness, and write me a report." You can change the instruction,
> pause it, or send the guard out right now.

---

## 5. Intensity: Light, Normal, Deep

Intensity controls **how many steps run** and therefore how thorough (and how
slow/heavy) the scan is. CyberSentinel uses three levels, each with a clear goal:

| Intensity | Goal | In one phrase |
|---|---|---|
| **LIGHT** | **Visibility** | "Just tell me what exists." |
| **NORMAL** | **Exposure** | "Tell me what exists *and* how exposed it is." |
| **DEEP** | **Risk signals** | "Everything, including active vulnerability checks." |

Concretely, for a **domain**:

- **LIGHT** finds subdomains, checks certificates, resolves DNS, and checks which
  ones respond. (~5 steps)
- **NORMAL** does all of LIGHT **plus** maps IPs, looks up geo/ASN info, scans
  common ports, fingerprints services, reads TLS details, and hints at API
  surface. (~13 steps)
- **DEEP** does all of NORMAL **plus** recursive/OSINT subdomain hunting, an
  actual **vulnerability scan** (Nuclei), cloud exposure checks, admin-panel
  hunting, exposed-backup hunting, and change detection. (~21 steps)

Think of it as **glance → inspect → full audit**.

---

## 6. Scheduling: Quick, Interval, Cron

A discovery can run:

- **QUICK** — run **once, right now** (a one-off scan).
- **INTERVAL** — run **every N hours** (e.g., every 24 hours). The `schedule_value`
  holds the interval.
- **CRON** — run on a precise calendar pattern using a *cron expression* (e.g.,
  "every Monday at 3 AM"). This is for advanced, exact timing.

Why schedule at all? Because the internet changes. A new test server appears, a
certificate expires, a port gets opened by mistake. Recurring scans catch those
changes automatically and feed the **Changes** view.

---

## 7. The discovery pipeline — what actually runs

This is the heart of ASM. A **pipeline** is an ordered list of **stages**, and
each stage runs one **tool**. The worker runs them **one after another**,
passing results forward (the subdomains found in step 1 become the input to the
DNS step, whose IPs become the input to the port scan, and so on).

After **each** step it emits a progress event, and when everything is done it
emits one **final "PIPELINE_COMPLETED"** event. That's how the UI can show a live
progress bar.

### 7a. Domain pipeline (the richest one)

| Stage | Tool | What it does (plain English) |
|---|---|---|
| `subdomain_discovery` | **subfinder** | Find sub-addresses like `mail.`, `vpn.`, `dev.` |
| `deep_discovery` | **amass** | Dig deeper for more subdomains (NORMAL+) |
| `recursive_osint` | **bbot** | Hunt subdomains from public/OSINT data (DEEP) |
| `subdomain_expansion` | **dnsgen** | Guess likely subdomain name variations (DEEP) |
| `cert_intel` | **crtsh** | Read public certificate logs to reveal more subdomains |
| `dns_resolution` | **dnsx** | Turn each subdomain into its real IP address(es) |
| `reachability_check` | **http_probe** | Which ones actually answer on the web? |
| `http_status` | **httpx** | Get HTTP status, page title, server type |
| `ip_mapping` | **ip_mapping** | Map subdomains → IPs (for the next steps) |
| `ip_info` | **ipinfo** | Geo-locate IPs (country, city, lat/long) |
| `asn_map` | **asnmap** | Find which network/provider (ASN) owns the IPs |
| `common_port_scan` | **top_ports_scanner (naabu)** | Find open "doors" (ports) |
| `service_fingerprint` | **service_detector (nmap)** | Identify the software behind each port |
| `tls_metadata` | **ssl_analyzer (sslscan)** | Inspect the encryption/certificate health |
| `api_surface_hint` | **api_detector (katana)** | Crawl for API/admin URLs |
| `vulnerability_scan` | **nuclei** | Actively test for known weaknesses (DEEP) |
| `cloud_exposure_detect` | **cloud_osint** | Find related public cloud buckets/resources (DEEP) |
| `admin_endpoint_check` | **admin_finder (gobuster)** | Hunt for exposed admin/login panels (DEEP) |
| `backup_file_check` | **backup_detector** | Probe for exposed backups like `/backup.zip`, `/db.sql` (DEEP) |
| `change_detection` | **asset_diff_engine** | Compare with the last scan; report what changed (DEEP) |

### 7b. IP pipeline

For an `ip` asset the steps are tuned for a single host: seed the target → check
if it's alive → port scan (TCP, and UDP at NORMAL/DEEP) → fingerprint services →
grab banners → check TLS (DEEP) → HTTP probe → enrich with geo/ASN → WHOIS/RDAP
ownership lookup → relationship mapping (DEEP) → change detection → **exposure
scoring** → findings summary (DEEP).

### 7c. Cloud, Service, Human pipelines

The code also defines pipelines for `cloud` (public-endpoint detection, read-only
config review, OSINT correlation), `service` (HTTP banner check, top-port
services, misconfig analysis), and `human` (email-leak check, repo secret scan,
OSINT correlation). See the [honesty section](#13) for which of these are fully
wired today.

### 7d. Robustness built into the runner

- **Optional tools never break the scan.** Tools like `crtsh`, `amass`, `nuclei`,
  `admin_finder`, etc. are marked *optional* — if one fails, that step is marked
  **SKIPPED** and the pipeline keeps going. Only a core step failing marks the
  whole run **FAILED**.
- **No infinite hangs.** If a job is cancelled or times out, the runner stops
  cleanly at the current step instead of freezing the worker.
- **Crash-proof.** A panic in any tool is caught and turns into a clean
  "this job failed," so one bad scan can't take down the whole worker.

---

## 8. What we find (the result categories)

Everything a pipeline discovers is stored and shown in dedicated tabs. Each is a
"category of doors and what's behind them":

| Category | What it lists | Why you care |
|---|---|---|
| **Subdomains** | Every sub-address found | Forgotten/dev subdomains are classic weak points |
| **IPs** | Every server address, with geo + ASN + cloud/CDN flags | Know *where* and *whose* your servers are |
| **Ports** | Open ports per IP (e.g., 22, 443, 3306) | Open database/admin ports = danger |
| **Services** | Software + version behind each port | Old versions = known vulnerabilities |
| **SSL Certs** | Certificate issuer, validity dates, cipher | Expired/weak certs break trust & security |
| **API endpoints** | Discovered API URLs + methods | Unprotected APIs leak data |
| **Admin endpoints** | Exposed admin/login panels | Public admin pages invite break-ins |
| **Cloud resources** | Public cloud buckets/resources | The #1 source of accidental data leaks |
| **Backup files** | Exposed `.sql`, `.zip`, `.bak` files (only ones that actually respond) | A downloadable DB dump is game over |
| **Changes** | What changed since last scan | Catch new exposure the moment it appears |

---

## 9. The Exposure / Risk Score — how a number gets decided

This is usually the part people most want to understand: **"Where does the 0–100
number come from, and why should I trust it?"**

CyberSentinel does **not** use a random or made-up number. It uses a transparent,
auditable model (`scoring/exposure.py`). Three principles:

1. **Explainable** — every single point is attributed to a named reason ("why").
2. **Standards-aligned** — it uses the same industry signals (CVSS, EPSS, KEV)
   that tools like Tenable / Qualys / Rapid7 use.
3. **Context-aware** — the *same* weakness scores higher on a public,
   business-critical server than on an internal, low-value one.

### 9a. The ingredients (what we look at)

For an asset we gather **signals**: open ports, running services, whether it's
public, TLS health, any CVEs (with their CVSS/EPSS/KEV), exposed admin panels,
exposed backup files, exposed API endpoints, and the asset's business
criticality.

### 9b. The recipe (how points add up)

Points are added for each risk signal, then adjusted by context. The real
weights, straight from the code:

**Open ports**
- Each **sensitive** port adds a fixed amount, because some doors are inherently
  dangerous when public. Examples:
  - SMB (445): **+14**, RDP (3389): **+14**, Redis (6379): **+14**,
    Elasticsearch (9200): **+14**, MongoDB (27017): **+14**
  - Docker API (2375): **+16** (the highest — remote control of containers)
  - MySQL (3306) / PostgreSQL (5432) / MSSQL (1433) / Oracle (1521): **+12**
  - Telnet (23): **+12**, VNC (5900): **+12**, FTP (21): **+8**
- Each **non-sensitive** open port adds **+1.5**.

**Vulnerabilities (CVEs)** — only the **worst** CVE drives the base, plus boosts:
- CVSS contribution = `(worst CVSS / 10) × 30`. So a CVSS-10 bug adds **+30**.
- EPSS boost = `worst EPSS × 20`. A 50%-likely-to-be-exploited bug adds **+10**.
- **KEV escalator** = a flat **+25** if *any* CVE on the asset is on CISA's
  actively-exploited list. (This is the big red flag.)
- **Volume** = each *additional* high/critical CVE beyond the worst adds **+2**.

**TLS problems**
- No TLS on a sensitive service: **+10**, expired cert: **+8**, weak cipher: **+6**,
  self-signed: **+5**, hostname mismatch: **+4**.

**Sensitive exposed endpoints**
- Each exposed **admin panel**: **+6**.
- Each exposed **backup file**: **+8**.
- Exposed **API endpoints**: **+1 each, capped at +10**.

**Context multipliers (applied at the end)**
- If the asset is **not** internet-facing, the whole score is **multiplied by
  0.45** (internal things are far less risky).
- Business criticality multiplier: low **×0.8**, normal **×1.0**, high **×1.2**,
  critical **×1.4**.

Finally the result is **clamped to 0–100** and rounded.

### 9c. From number to severity band

| Score | Severity |
|---|---|
| 80–100 | **Critical** |
| 60–79 | **High** |
| 40–59 | **Medium** |
| 20–39 | **Low** |
| 0–19 | **Info** |

### 9d. A worked example (so it's concrete)

A **public** web server with:
- Port 443 open (normal, non-sensitive) → +1.5
- Port 3306 (MySQL) open to the public → **+12**
- One CVE: CVSS 9.8, EPSS 40%, and it's on the KEV list →
  `(9.8/10)×30 = 29.4` **+** `0.40×20 = 8` **+** `25 (KEV)` = **+62.4**
- Expired TLS certificate → **+8**

Raw total ≈ `1.5 + 12 + 62.4 + 8 = 83.9`. It's public (no dampening) and normal
criticality (×1.0). **Final score ≈ 84 → "Critical."**

And crucially, the UI can show **exactly that breakdown** ("why this score"):
*MySQL exposed (+12), worst CVE (+29.4), EPSS (+8), KEV present (+25), expired
cert (+8)…* — so a security team can defend the number in an audit.

> **Takeaway:** the score isn't a vibe. It's a sum of named, industry-standard
> reasons, dampened for internal assets and scaled for how important the asset is.

---

## 10. The screens in CyberSentinel (component by component)

Here's every ASM-related screen and what each control does.

### 10a. ASM Overview (the ASM dashboard)
- **Attack-surface index** — an overall exposure number for your whole org
  (average of asset scores).
- **Asset counts** — domains, subdomains, IPs, cloud, services discovered.
- **Exposure summary** — public assets, internet-facing services, unknowns.
- **Exposure breakdown** — how many assets fall in high / medium / low buckets.
- **Top exposed assets** — your riskiest things, worst first.
- **Recent activity** — real events from the audit log (who did what).

### 10b. Discovery Manager
- **Create discovery** — name it, choose target source (existing assets or manual
  entry), asset type, **intensity**, and **schedule**.
- **Run / Re-run Now** — immediately queues the discovery to the worker fleet
  (real backend call: `POST /asm/discoveries/{id}/run`).
- **Pause / Stop** — sets the discovery to `PAUSED` so it won't run.
- **Delete** — removes the discovery.
- **Discoveries list & run history** — every discovery and every past run with
  duration and status.

### 10c. Finding tabs
Subdomains, IPs, Ports, Services, SSL Certs, API Endpoints, Admin Endpoints,
Cloud Resources, Backup Files, Changes — each is a searchable, paginated table
fed by a real `/asm/...` endpoint, scoped to your org. (See [section 8](#8).)

### 10d. Exposure Signals
A focused view of scored IPs: each row shows its exposure score and **expands to
show the factor-by-factor "why"** (the same breakdown from
[section 9](#9)) — real CVSS/EPSS/KEV-aware scoring, computed server-side.

### 10e. IP Geo Map
An interactive world map (react-simple-maps) plotting your discovered IPs by
their real latitude/longitude:
- **Zoom & pan** the globe.
- **Click a marker** to see that IP's details.
- **Country breakdown** computed server-side from the geo data.
This answers "*where on earth are my servers, and whose network are they on?*"

### 10f. ASM Settings
Your saved preferences — most importantly the **score thresholds** that decide
where "high / medium / low" boundaries sit for *your* org. Saving persists to the
backend (`PUT /asm/settings`) and reloads on next visit.

---

## 11. The architecture — how data flows through the system

CyberSentinel is split into parts that each do one job. Here's the journey of a
single discovery, from click to chart:

```
   You (browser / React UI)
        │  1. Create / Run discovery
        ▼
   API service (FastAPI, Python)              ← verifies your Supabase login,
        │  2. Save discovery row (Postgres)     stamps it with YOUR org_id
        │  3. Publish a job message ───────────────────────┐
        ▼                                                   │
   RabbitMQ  (message queue "jobs.asm")  ◄──────────────────┘
        │  4. A worker picks up the job
        ▼
   Go Workers
     • Orchestration builds the PIPELINE (stages × tools) for the
       asset type + intensity, and stores it in Redis.
     • Executor runs each stage's tool in order (subfinder → dnsx →
       naabu → nmap → sslscan → nuclei → …), passing results forward.
     • After EACH step → emit a progress event.
     • At the very end → emit ONE "PIPELINE_COMPLETED" event.
        │  5. Results + events published to RabbitMQ ("report.asm")
        ▼
   Reporting consumer  +  Redis (live pipeline state)
        │  6. Parse results, run EXPOSURE SCORING, write findings
        ▼
   Postgres  (subdomains, ips, ports, services, ssl, endpoints, scores…)
        │  7. Stored per-org
        ▼
   API service  ◄── 8. UI calls /asm/... endpoints (org-scoped)
        │
        ▼
   You see it: dashboards, tables, the geo map, the "why" breakdown
```

Key supporting players:
- **Supabase** = the identity provider (who you are; login, OAuth, password
  reset). Every request carries a verified token.
- **`org_id`** = your tenant key. **Every** database query filters by it, so one
  company can never see another's assets, discoveries, or findings.
- **Redis** = fast scratchpad holding the live pipeline state (drives the
  progress bar).
- **RabbitMQ** = the conveyor belt connecting the API to the worker fleet, so
  heavy scanning happens in the background and the UI stays fast.

**Important sequencing rule baked into the design:** scoring happens **only after
the pipeline completes**, never half-way. You always score a complete picture.

---

## 12. A full real-life walkthrough

Let's follow one concrete example from start to finish.

**Goal:** Sara, a security analyst at Acme Inc., wants to know how exposed
`acme.com` is.

1. **Add the asset.** On *Asset Inventory*, Sara adds `acme.com` (type `domain`,
   exposure `public`, tag `production`). Its score shows **"Unscanned"** — we
   haven't measured it yet.

2. **Create a discovery.** On *Discovery Manager*, she creates "Acme Weekly":
   target source = FROM_ASSET (`acme.com`), intensity = **NORMAL**, schedule =
   **INTERVAL every 168 hours** (weekly). She also clicks **Run Now** to start
   immediately.

3. **The job queues.** The API saves the discovery (stamped with Acme's
   `org_id`), and drops a message on the `jobs.asm` queue.

4. **A worker takes it.** The orchestration layer builds the NORMAL domain
   pipeline (~13 stages) and stores it in Redis. The executor begins:
   - `subfinder` finds `mail.acme.com`, `vpn.acme.com`, `dev.acme.com`, …
   - `crtsh` adds `staging.acme.com` from certificate logs.
   - `dnsx` resolves each to IPs.
   - `http_probe` + `httpx` see which respond and grab titles/servers.
   - `ipinfo` + `asnmap` locate the IPs (e.g., "US, AWS").
   - `naabu` finds open ports — uh oh, `dev.acme.com` has **3306 (MySQL)** open.
   - `nmap` fingerprints it as "MySQL 5.7".
   - `sslscan` notices `staging.acme.com` has an **expired certificate**.
   - After each step, a progress event ticks the UI bar forward.

5. **Pipeline completes.** A single `PIPELINE_COMPLETED` event fires. The
   reporting consumer parses everything, runs **exposure scoring**, and writes
   findings to Postgres.

6. **Scoring.** `dev.acme.com` gets a high score because a public MySQL port
   (+12) plus its context pushes it up; `staging.acme.com` is dinged for the
   expired cert (+8). Each score carries its **"why"** breakdown.

7. **Sara reviews.**
   - The *ASM Overview* now shows real counts and a higher attack-surface index.
   - *Subdomains/Ports/SSL* tabs list exactly what was found.
   - *Exposure Signals* shows `dev.acme.com` near the top; she expands it and
     sees "MySQL exposed (+12)" in plain language.
   - The *IP Geo Map* shows pins in the US (AWS).
   - The *Dashboard* "Recent Alerts" reflects the new activity.

8. **She acts.** She closes the public MySQL port and renews the staging
   certificate.

9. **Next week, automatically.** The weekly interval re-runs. The
   `change_detection` step reports "MySQL 3306 on dev.acme.com: now closed ✅" in
   the **Changes** view — proof the fix worked.

That's ASM: *find → inspect → score → show → re-check.*

---

## 13. Honesty section: what exists in the code but isn't fully wired

Good documentation tells you the edges, not just the happy path. As of this
guide:

- **Discovery asset types actually run by the engine:** `domain`, `ip`, and
  `cloud` are wired through the create flow. The pipeline config *also* defines
  full stage lists for **`service`** and **`human`** asset types (e.g., email-leak
  checks, repo secret scans, OSINT correlation), but those aren't exposed as
  first-class discovery types in the create form yet — they're built and waiting.
- **Some DEEP-only tools are best-effort.** Stages like `cloud_osint`,
  `admin_finder`, `nuclei`, `backup_detector`, and `asset_diff_engine` are marked
  *optional* — if a tool or its data isn't available, the step is **SKIPPED**
  rather than failing the whole scan. `asset_diff_engine` returns "no previous
  scan to compare" until a second run exists.
- **The vulnerability-scanning (VS) module is separate from ASM** and is not yet
  a durable, persistent subsystem — so org-wide "open vulnerabilities" counts
  read honestly as zero until a real scan worker populates them. ASM's own
  exposure scoring is fully real and independent of that.
- **Reports / Notifications / Activity** (outside ASM proper) are now real and
  org-scoped, and the Dashboard's "recent activity" feed is fed by the real audit
  log.

None of the above affects the core ASM loop (discover → inspect → score → show),
which is fully functional for domains, IPs, and cloud assets.

---

## 14. Glossary

- **ASM** — Attack Surface Management: finding and reducing everything an
  attacker could reach from the outside.
- **Asset** — one online thing you own (domain, ip, cloud, repo, saas, user).
- **ASN** — "Autonomous System Number": identifies which network/provider owns a
  block of IPs (e.g., AWS, Cloudflare).
- **Banner** — the little ID text a service announces when you connect (reveals
  software & version).
- **CDN** — Content Delivery Network (e.g., Cloudflare); a layer that serves your
  site from many locations.
- **CVE / CVSS / EPSS / KEV** — a named vulnerability / its 0–10 severity / its
  0–100% likelihood of exploitation / the "actively exploited right now" list.
- **Discovery** — a saved exploration job that scans targets.
- **Exposure** — how reachable something is from the public internet.
- **Intensity** — Light / Normal / Deep: how thorough a discovery is.
- **Pipeline** — the ordered stages+tools a discovery runs.
- **Port** — a numbered service "door" on a server.
- **RDAP / WHOIS** — lookups that reveal who registered/owns an IP or domain.
- **Subdomain** — a sub-address under your main domain.
- **Tenant / org_id** — your isolated company space; the key that keeps your data
  private.
- **TLS / SSL** — the encryption + certificate behind the padlock 🔒.

---

### One-line summary

> **ASM in CyberSentinel = an automated outside-in scout that finds everything
> you own on the internet, inspects each piece, gives it an explainable 0–100
> risk score, shows it on clear dashboards and a world map, and re-checks on a
> schedule so you fix problems before attackers find them.**

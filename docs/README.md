# CyberSentinel — Engineering Documentation

> **Single source of truth** for the CyberSentinel security platform. Written to onboard a senior engineer in a day, let a DevOps engineer deploy without asking anyone, and let Product/QA/Support/Sales understand every module. Modular by service so new modules (Threat Intelligence, etc.) slot in without a rewrite.

CyberSentinel is a multi-tenant SaaS security platform. Its first live module is **Attack Surface Management (ASM)** — automated discovery and exposure scoring of an organization's internet-facing assets. See [00_inventory.md](00_inventory.md) for the one-page factual map.

---

## The five guides

| # | Guide | What it answers | Audience |
|---|---|---|---|
| 0 | **[Repository Inventory](00_inventory.md)** | What exists? Services, deps, APIs, data stores. The backbone every other doc references. | Everyone |
| 1 | **[Developer Guide](01_developer_guide/overview.md)** | How is each service built, and *why*? Deep per-service architecture. | Engineers |
| 2 | **[Glossary & Panel Guide](02_glossary_and_panel_guide/domain_glossary.md)** | What does every term and every on-screen field mean? | Non-technical + new devs |
| 3 | **[Local Setup Guide](03_local_setup_guide.md)** | How do I run the whole stack locally from scratch? | Engineers |
| 4 | **[Infra & API Guide](04_infra_and_api_guide/infra.md)** | How does it deploy, and what are all the APIs? | DevOps + integrators |
| 5 | **[Database Guide](05_database_guide.md)** | What is every table/store and how does data flow? | Engineers + DBAs |

### Guide 1 — Developer Guide (per-service)
- [Overview](01_developer_guide/overview.md) — the whole system and how services connect
- [Architecture Diagram](01_developer_guide/architecture_diagram.md) — full system Mermaid diagrams
- [API Service (FastAPI)](01_developer_guide/api_service.md) `[Module: Core-Platform + ASM]`
- [Go Workers](01_developer_guide/workers.md) `[Module: ASM]`
- [Reporting Consumer](01_developer_guide/reporting.md) `[Module: ASM]`
- [Notification Service](01_developer_guide/notificationservice.md) `[Module: Core-Platform]`
- [Frontend](01_developer_guide/frontend.md) `[Module: Core-Platform + ASM]`
- [Infrastructure](01_developer_guide/infra.md) `[Module: Core-Platform]`

### Guide 2 — Glossary & Panels
- [Domain Glossary](02_glossary_and_panel_guide/domain_glossary.md) — every security/ASM/infra/AI term, plain + technical
- [Panel Guide](02_glossary_and_panel_guide/panel_guide.md) — every screen and field, and where its data comes from

### Guide 4 — Infra & API
- [Infrastructure](04_infra_and_api_guide/infra.md) — local → staging → prod, CI/CD, scaling, secrets
- [API Guide](04_infra_and_api_guide/api_guide.md) — every endpoint, auth, request/response, errors

---

## Documentation conventions

- **Module tags.** Sections are tagged with the module they belong to — `[Module: ASM]`, `[Module: Core-Platform]`, `[Module: Auth]` — so future modules append cleanly.
- **`[NEEDS CONFIRMATION FROM DEV]`** marks anything inferred from code but not verified. The full list lives in [§7 of the inventory](00_inventory.md#7-open-questions--confirmation-needed). Never delete a flag without confirming the fact.
- **`[INFERRED]`** marks design *reasoning* deduced from code patterns/commits rather than explicit documentation.
- **Cross-links.** Every jargon term links to the [Glossary](02_glossary_and_panel_guide/domain_glossary.md); every service links to its data in the [Database Guide](05_database_guide.md).
- **Diagrams** are Mermaid (render in GitHub and most Markdown viewers). Exportable to PDF.
- **Secrets:** only variable *names* appear anywhere in these docs — never values.

---

## How to extend these docs (adding a new module)

CyberSentinel is a module framework. When a new module (e.g. **Threat Intelligence**) is added, **do not touch existing module sections** — append new tagged sections following the templates:

1. **Inventory** ([00_inventory.md](00_inventory.md)) — add rows to the service, API-surface, and data-store tables with a `[Module: Threat-Intel]` tag.
2. **Developer Guide** — copy an existing per-service file (e.g. [workers.md](01_developer_guide/workers.md)) to `01_developer_guide/threatintel_service.md` and fill the same 9 sections (Purpose, Architecture, Why built this way, Alternatives/trade-offs, Key files, Dependencies, Known limitations, Future improvements, Connects to other modules). Add it to [overview.md](01_developer_guide/overview.md) and the system diagram in [architecture_diagram.md](01_developer_guide/architecture_diagram.md).
3. **Glossary & Panels** — add a new `Category: Threat-Intel` section to [panel_guide.md](02_glossary_and_panel_guide/panel_guide.md) and any new terms to [domain_glossary.md](02_glossary_and_panel_guide/domain_glossary.md). Never edit the ASM category.
4. **Infra & API** — add the new router's endpoints to [api_guide.md](04_infra_and_api_guide/api_guide.md) under a new grouped heading; add any new deploy units to [infra.md](04_infra_and_api_guide/infra.md).
5. **Database** — add the module's tables + a sub-ER-diagram to [05_database_guide.md](05_database_guide.md). Every new table must carry `org_id` (FK → `organizations`, `ON DELETE CASCADE`) per the tenancy contract.

The plumbing a new module inherits for free: Supabase auth + RBAC, org tenancy, the RabbitMQ job/report queues, the scheduler, the notification bus, and the realtime WebSocket. Reuse them — don't rebuild.

---

*Generated 2026-07-04 by reverse-engineering the codebase. Keep it current: when you change a service, update its guide in the same PR.*

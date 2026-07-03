# API Guide `[Module: Core-Platform + ASM]`

> Every HTTP/WebSocket surface CyberSentinel exposes. All served by `api_service` under base prefix **`/api/v1`**. Interactive docs at `/docs` (Swagger) when running.

**Related:** [API Service](../01_developer_guide/api_service.md) · [Inventory §4](../00_inventory.md#4-api-surface-by-service) · [Frontend API layer](../01_developer_guide/frontend.md#5-api-layer) · [Database](../05_database_guide.md)

---

## Table of Contents
1. [Conventions](#1-conventions)
2. [Authentication](#2-authentication)
3. [Authorization (RBAC)](#3-authorization-rbac)
4. [Error handling](#4-error-handling)
5. [Rate limiting](#5-rate-limiting)
6. [Health & ops endpoints](#6-health--ops-endpoints)
7. [Endpoint catalog](#7-endpoint-catalog)
8. [WebSocket API](#8-websocket-api)
9. [Internal APIs](#9-internal-apis)
10. [Webhooks](#10-webhooks)
11. [Examples](#11-examples)

---

## 1. Conventions
- **Base URL:** `${API}/api/v1`. **Content type:** JSON.
- **Auth:** `Authorization: Bearer <supabase-jwt>` on all authenticated routes.
- **Pagination:** list endpoints accept `page`, `page_size` and return `{ items, total, page, page_size }` (`Paginated<T>`).
- **Filtering/sorting:** `q` (search), `sort_by`, `sort_dir` on ASM list endpoints; ASM child lists also accept `discovery_id`.
- **Versioning:** single `/api/v1` prefix; no other versions yet.

## 2. Authentication
Identity is **Supabase**; the backend only *verifies* JWTs.
- `verify_supabase_jwt` branches on the token's `alg`: **HS256** (shared `SUPABASE_JWT_SECRET`) or **ES256/RS256** (verified via cached JWKS). Algorithms are **pinned server-side** — never read from the token header (defeats alg-confusion/downgrade). Audience pinned to `"authenticated"`.
- On success → `CurrentUser(user_id, email, role, org_id)`. **Role and org come from the DB (`member_profiles`), never the token.**
- **JIT provisioning:** first sight of a user creates their `Organization` (they become `owner`) + `MemberProfile`.
- Two dependency styles coexist (migration in progress): typed `CurrentUser` (assets/reports/orgs/tasks/notifications/activity/auth) and legacy dict (asm/vs/billing/services). Both verify the same JWT. See [migration note](../01_developer_guide/overview.md#5-the-active-migration-you-must-know-about).

## 3. Authorization (RBAC)
Roles: **`owner > admin > analyst > reader`**.
- **Writers:** owner/admin/analyst. **Readers:** read-only.
- Enforced via `require_role(...)` dependency (typed routers) or in-body `_require_write_access(...)` (ASM). 403 on violation.
- **owner** is never assignable via invite or role change. Org-scoped operations 404 across tenants (you can't see another org's resources).

## 4. Error handling
| Status | Meaning | Behavior |
|---|---|---|
| 400 | Bad request / validation | Pydantic or explicit checks |
| 401 | Missing/invalid JWT | frontend logs out + redirects to `/login` |
| 403 | Authenticated but not permitted (RBAC / no org) | frontend shows a permission error, does **not** log out |
| 404 | Not found / cross-tenant | tenant isolation returns 404 for other orgs' resources |
| 409 | Conflict (e.g. pausing a non-RUNNING discovery) | |
| 429 | Rate limit exceeded | |
| 500 | Unhandled | generic body + logged with `correlation_id` (no internal details leak) |
| 501 | Not implemented (services purchase/activate) | |
| 503 | Dependency down (readiness, unconfigured webhook secret) | |

> Consistency note: `asm.py` `/runs/{id}` returns 403 (not 404) when unauthorized — an existence oracle to be fixed. See [api_service tech debt](../01_developer_guide/api_service.md#13-known-limitations--tech-debt).

## 5. Rate limiting
Redis fixed-window per IP: **auth POST** (`/api/v1/auth*`) = 10/min; **other writes** = 120/min. **Fails open** if Redis is down. `X-Forwarded-For` is trusted only when `TRUSTED_PROXY_HOPS > 0`.

## 6. Health & ops endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/` | root banner |
| GET | `/health` | liveness → 200 |
| GET | `/readyz` | readiness — hard-checks DB (503 if down), best-effort Redis/RabbitMQ |
| GET | `/metrics` | Prometheus text, dependency-liveness gauges |

## 7. Endpoint catalog

### Auth — `/api/v1/auth` `[Module: Auth]` (typed `CurrentUser`)
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/me` | any | verified identity + synced profile/org/role (`MeResponse`) |
| PATCH | `/profile` | any | update `full_name`/`avatar_url`/`country`/`phone` |
| GET | `/settings` | any | member notification + preference settings |
| PUT | `/settings` | any | upsert per-(org,user) settings |

### Orgs — `/api/v1/orgs` `[Module: Auth]` (`require_role`)
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/me/members` | any member | list org members |
| PATCH | `/members/{id}/role` | owner/admin | set role ∈ {admin,analyst,reader}; can't touch owner; tenant-isolated; audited |
| DELETE | `/members/{id}` | owner/admin | soft-delete member (can't remove owner); audited |
| GET | `/invites` | any member | list invites |
| POST | `/invites` | owner/admin | create single-use invite (72h TTL); emails it |
| DELETE | `/invites/{id}` | owner/admin | revoke invite |
| POST | `/invites/accept` | any auth | accept (email-match + unexpired + pending) |

### ASM — `/api/v1/asm` `[Module: ASM]` (legacy dict auth; writes gated in-body)
| Group | Endpoints |
|---|---|
| Settings | `GET /settings`, `PUT /settings` *(write; per-user; unvalidated dict)* |
| Discoveries | `POST /discoveries` *(write; SSRF-guarded + ownership-gated)*, `GET /discoveries`, `GET /discoveries/{id}`, `PATCH /discoveries/{id}` *(write)* |
| Lifecycle | `POST /discoveries/{id}/run\|pause\|resume\|stop` *(write; emit realtime events)*, `DELETE /discoveries/{id}` *(write)* |
| Dashboards | `GET /dashboard`, `GET /dashboard/overview` |
| Exposure | `GET /exposure?limit=` *(per-IP scoring; capped `ASM_MAX_EXPOSURE_IPS`)* |
| Subdomains | `GET /subdomains`, `GET /subdomains/{id}`, `GET /subdomains/{id}/ips` |
| IPs | `GET /ips`, `GET /ips/geo-map` |
| Findings (child lists) | `GET /ports`, `/services`, `/ssl`, `/api-endpoints`, `/cloud-resources`, `/admin-endpoints`, `/backup-files`, `/changes`, `/repo-findings`, `/saas-apps`, `/user-accounts` |
| Runs | `GET /runs`, `GET /runs/{run_id}`, `GET /discoveries/{id}/runs` |

Creating/running a discovery publishes to RabbitMQ `jobs.asm` with `{type:"asm", user_id, id, asset_type, target_source, intensity}`. Field/panel mapping: [Panel Guide](../02_glossary_and_panel_guide/panel_guide.md).

### Assets — `/api/v1/assets` `[Module: ASM]` (reference secure pattern)
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `""` | any | list (filter q/type/exposure, paginated) |
| POST | `""` | writer | create asset |
| POST | `/import` | writer | bulk CSV import (dedup + type validation) |
| GET/PATCH/DELETE | `/{id}` | any / writer | read / update / delete |
| POST | `/{id}/rescore` | writer | recompute exposure from real scan data |
| POST | `/{id}/verification-token` | writer | issue ownership token (DNS TXT for domains; attestation otherwise) |

### Reports — `/api/v1/reports` `[Module: Core-Platform]`
`POST /generate` *(write)*, `GET ""`, `GET /scheduled`, `POST /scheduled` *(write)*, `PATCH /scheduled/{id}` *(write)*, `DELETE /scheduled/{id}` *(write)*, `GET /{id}`, `GET /{id}/download` *(pdf/csv/json; CSV formula-injection neutralized)*, `DELETE /{id}` *(write)*. Built from real tenant data.

### Tasks — `/api/v1/tasks` `[Module: Core-Platform]` (all members read+write)
`GET ""`, `POST ""`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`, `GET /{id}/messages`, `POST /{id}/messages` *(platform ∈ internal/slack/jira/email)*.

### Notifications — `/api/v1/notifications`
`GET ""` *(falls back to audit-log-derived items)*, `GET /unread-count`, `POST /{id}/read`, `POST /{id}/unread`, `POST /read-all`, `GET /preferences`, `PUT /preferences`.

### Activity — `/api/v1`
`GET /activity`, `GET /audit-logs` — real `audit_logs`, org-scoped, actor IDs mapped to names.

### Vulnerability Scanning — `/api/v1/scans` + `/api/v1/vs` `[Module: VS]` (in-memory, interim)
`GET /vs/dashboard`, `POST /scans`, `GET /scans/{id}`, `POST /scans/{id}/retest`, `DELETE /scans/{id}`. **Not durable** — process dicts, lost on restart.

### Billing — `/api/v1/billing` (legacy models)
`GET /plan`, `POST` (subscribe/change), `POST /cancel`, `GET /invoices`. Uses legacy `Company`/`User` + superadmin check.

### Services — `/api/v1/services`
`GET ""`, `GET /{id}` (admin). Purchase/activate/deactivate → **501**. Catalog: ASM available; others coming-soon.

### Marketing — `/api/v1/marketing` (no auth)
`POST /contact`, `POST /early-access` (persists `NewsletterLead`).

## 8. WebSocket API
`GET /api/v1/ws/realtime` — realtime event stream. Auth via **subprotocol** `["cybersentinel-auth", <jwt>]` (token kept out of URL/logs). 25s heartbeat ping; capped-backoff reconnect. Event types: `scan.started|completed|failed|stopped`, `findings.new`, `finding.critical|high`, `team.message`. Delivery/gating: [Notification Service](../01_developer_guide/notificationservice.md).

## 9. Internal APIs
The Go **control-plane** exposes `POST /asm/jobs/start` (default `:8090`) for the consumer to call. Auth: header `X-Internal-Token` (binds `127.0.0.1` if unset). Body `{type:"asm", user_id, id}`. **Not internet-facing** — never route through the public ingress. See [Workers §5](../01_developer_guide/workers.md#5-the-control-plane-orchestrator--executor).

## 10. Webhooks
`POST /api/v1/auth/webhook/supabase` — Supabase DB webhook on `auth.users`. Auth: constant-time HMAC (`hmac.compare_digest`) against `SUPABASE_WEBHOOK_SECRET` (503 if unconfigured, 401 if bad). INSERT → provision profile+org; DELETE → soft-delete + audit; UPDATE handled by JIT sync.

## 11. Examples

**Get current identity**
```bash
curl -s https://api.cybersentinel.com/api/v1/auth/me \
  -H "Authorization: Bearer $JWT"
```

**Create and run a domain discovery**
```bash
# create
curl -s -X POST https://api.cybersentinel.com/api/v1/asm/discoveries \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"prod domains","asset_type":"domain","target_source":"MANUAL_ENTRY",
       "targets":["*.company.com"],"intensity":"NORMAL","schedule_type":"QUICK"}'
# run it (id from the create response)
curl -s -X POST https://api.cybersentinel.com/api/v1/asm/discoveries/$ID/run \
  -H "Authorization: Bearer $JWT"
```

**List exposed IPs (paginated, sorted)**
```bash
curl -s "https://api.cybersentinel.com/api/v1/asm/ips?page=1&page_size=50&sort_by=exposure_score&sort_dir=desc" \
  -H "Authorization: Bearer $JWT"
```

> Request/response *shapes* are inferred from the route code; run `/docs` for the authoritative live schema. Any field-level ambiguity is `[NEEDS CONFIRMATION FROM DEV]` against the Pydantic models.

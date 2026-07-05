# CyberSentinel — Master Roadmap: 0 → 10/10

> **Mission:** Build a world-class cybersecurity platform. Get the *foundation* (auth, identity, tenancy, the things every screen depends on) to genuinely excellent first — then drive **ASM to a 10/10 across every dimension** (product, security, scale, industry standards) before expanding to VS and the rest.
>
> **Strategy in one line:** *Fix the foundation → make the must-have functional flows excellent → ship a narrow, world-class ASM → expand.*
>
> **Auth decision (locked):** Supabase owns **all authentication and auth-related concerns** (identity, sessions, OAuth, password reset, email verification, MFA). **PostgreSQL** remains the source of truth for **all application data** (orgs, assets, ASM findings, reporting). The backend validates Supabase JWTs and syncs a local profile/org row.

---

## 0. How we score 10/10

A dimension is **10/10** only when it is *demonstrably* enterprise-grade — not "works on my machine." Every phase below ends with **exit criteria** that must be true and **verifiable** (a test passes, a scan runs, a dashboard shows green).

| # | Dimension | What 10/10 means (the bar we are building to) |
|---|-----------|-----------------------------------------------|
| 1 | **Architecture** | Clear bounded contexts, dependency direction inward, no in-memory critical state, horizontally scalable, multi-tenant by design. |
| 2 | **Security** | Passes external pen-test & OWASP ASVS L2. No critical/high findings. SSO, MFA, RBAC, audit trail, encrypted in transit/at rest. |
| 3 | **ASM maturity** | Feature-parity on the essentials with Defender EASM / Xpanse / Censys: discovery, fingerprinting, screenshots, ownership verification, continuous monitoring, change detection, defensible scoring. |
| 4 | **Backend** | Typed, tested, DI-based, transactional, observable, no stub endpoints. |
| 5 | **Frontend** | Auth-guarded, typed (strict), state-managed (react-query), decomposed components, accessible, zero mock data. |
| 6 | **Database** | Versioned migrations (Alembic), FKs, tenant column, indexes, soft-delete + audit, partition/archival strategy. |
| 7 | **DevOps** | CI/CD with build+test+SAST+SCA+secret+image scan; hardened non-root images; IaC that actually deploys. |
| 8 | **Performance** | No N+1s on hot paths; timeouts/limits everywhere; scales to 100k+ assets per tenant. |
| 9 | **Scalability** | Stateless services, distributed job state, HPA, external connection pooling. |
| 10 | **Reporting** | Decomposed, idempotent ingestion, generated exec/customer/developer reports, scheduled + exportable. |
| 11 | **Product/UX** | Coherent analyst workflow, real data end-to-end, no fake widgets, honest module surface. |
| 12 | **Testing** | Unit + integration + e2e; CI-gated; meaningful coverage on auth, tenancy, pipeline, parsers. |
| 13 | **Observability** | Metrics (Prometheus), tracing (OTel), error tracking (Sentry), deep health/readiness, log aggregation, SLOs. |
| 14 | **Compliance** | Threat model, audit logging, data retention, runbooks; SOC 2 Type II / ISO 27001 track. |

**Current baseline (from the June 2026 audit):** Architecture 4.5 · Security 2.5 · ASM 6.0 · Backend 4.0 · Frontend 3.5 · DB 4.0 · DevOps 1.5 · Performance 3.0 · Scalability 2.0 · Reporting 3.0 · Product 3.5 · Testing 0 · Observability 1.5. **Composite ≈ 3.0/10.**

---

## 1. Guiding principles

1. **Foundation before features.** A beautiful ASM on a forgeable-auth, no-tests base is worthless. We fix the base first.
2. **Honesty in the product surface.** Nothing ships labeled "functional" that is a mock. VS stays clearly "preview" until it actually scans.
3. **Every fix ships with a test.** We are at 0% coverage; from now on, no merge without tests on the changed path.
4. **Security is a gate, not a phase.** Each PR passes SAST/secret/dependency scans. Auth, tenancy, and SSRF are non-negotiable.
5. **Narrow then deep.** We make ASM world-class before widening to VS/BAS/TI/IR/CA. One great module beats six mediocre ones.
6. **Delete, don't accumulate.** Mock data, dead stub endpoints, duplicate docs, and the 1,599-line reporting monolith get removed, not patched.

---

## 2. Phase map (sequence & dependencies)

```
P0  Stop-the-bleed security + secrets            (Week 1)        ── blocks everything
P1  Auth & Identity on Supabase  ★FOUNDATION★    (Weeks 1–3)     ── blocks all app flows
P2  Functional core: profile, team, settings     (Weeks 3–5)     ── depends on P1
P3  Platform spine: tenancy, migrations, CI,      (Weeks 4–8)     ── parallel w/ P2
    tests, observability, container hardening
P4  ASM → 10/10  ★PRIMARY GOAL★                  (Weeks 6–20)    ── depends on P1–P3
P5  Reporting rewrite (ASM-scoped)               (Weeks 12–18)   ── inside P4
P6  Enterprise & compliance hardening            (Weeks 16–26)
P7  VS rebuild + remaining modules               (Month 7+)      ── only after ASM 10/10
```

Phases overlap where safe. **P0 and P1 are strictly first.**

---

## 3. Phase 0 — Stop-the-bleed (Week 1)

These are the audit's critical blockers. Do them before anything else; most are hours, not days.

- **Secrets:** add `.gitignore` (`.env`, `*.env`) + `.dockerignore` + `.env.example`; rotate every secret currently in the tree (DB, RabbitMQ, the hardcoded Gmail app password in `notificationservice/email.py:13`, JWT); move to env/secret manager. Purge from git history.
- **Kill forgeable JWTs:** the moment Supabase auth lands (P1) the hardcoded `JWT_SECRET`/`SECRET_KEY` fallbacks in `config/settings.py:40-47` are deleted and replaced by fail-fast validation.
- **CORS:** parse `CORS_ORIGINS` into a real allow-list; never wildcard + credentials (`main.py:29-35`).
- **Error hygiene:** stop returning `str(e)` to clients (`auth.py`, `users.py`); add a global exception handler + security-headers middleware (HSTS/CSP/X-Frame-Options).
- **Worker safety quick wins:** replace the `bash -lc` nmap call (`executor/runner/ip.go:207`) with arg-slice exec; add `defer recover()` in the executor; wire the already-defined `TaskTimeoutSec`.

**Exit criteria:** no secrets in repo; CI secret-scan clean; CORS is an explicit list; no stack traces in responses; worker survives a tool panic.

---

## 4. Phase 1 — Auth & Identity on Supabase ★ FOUNDATION ★ (Weeks 1–3)

This is the single most important phase. Everything (login, who-can-see-what, tenant isolation) hangs off it. We replace the custom-JWT, localStorage, stub-ridden auth with **Supabase as the identity provider** and a **thin, correct backend that trusts Supabase JWTs and owns app-level authorization**.

### 4.1 Architecture

```
React SPA ──(supabase-js: signup/login/OAuth/reset/MFA)──► Supabase Auth
   │  holds session, auto-refresh, sends access_token (JWT) as Bearer
   ▼
FastAPI  ──validates Supabase JWT (JWKS/secret)──► extracts sub, email, role
   │  on first request: upsert local `profiles` + `organizations` row (sync)
   ▼
PostgreSQL  ── source of truth for orgs, members, assets, ASM, reporting
```

- **Supabase owns:** credentials, password hashing, email verification, password reset, magic links, OAuth (Google + GitHub), MFA/TOTP, session + refresh tokens, JWT issuance.
- **Backend owns:** validating the JWT, mapping `sub → org/role`, all *authorization* (tenant isolation, RBAC), and app data.
- **No passwords ever touch our backend or DB again.** `users.hashed_password` is dropped.

### 4.2 Backend work (FastAPI)

1. **`utils/supabase_auth.py`** — verify Supabase JWT (HS256 via project JWT secret, or RS256 via JWKS), cache keys, return claims. *(scaffolded in this phase — see `/backend/api_service/utils/supabase_auth.py`)*
2. **`get_current_user` dependency** — extract `sub`/`email`/`role`, **upsert** the local profile + org on first sight (just-in-time provisioning), return a typed `CurrentUser` carrying `org_id` + `role`. One place enforces identity.
3. **Schema migration** — add `supabase_user_id (uuid, unique)` to profiles; make `hashed_password` nullable then drop; introduce `organizations` as the tenant root with `org_id` FK everywhere (P3 finishes the backfill).
4. **Slim the auth router** — delete the stub endpoints (`refresh`, `forgot-password`, `reset-password`, `magic-link`, fake `logout`). Keep only: `GET /auth/me` (sync + return profile/org/role), `PATCH /auth/profile`, and the team-invite accept flow. Everything credential-related now lives in Supabase.
5. **RBAC** — role claim (`owner|admin|analyst|reader`) enforced server-side via a `require_role(...)` dependency on every write endpoint. Remove client-trusted `canWrite`.
6. **Webhook (optional, robust path)** — a Supabase Auth Hook / DB webhook that pushes `user.created`/`user.deleted` to the backend so provisioning isn't purely lazy.

### 4.3 Frontend work (React)

1. **`lib/supabase.ts`** — `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` with `persistSession` + `autoRefreshToken`. *(scaffolded — see file)*
2. **`contexts/AuthContext.tsx`** — exposes `session`, `user`, `signInWithPassword`, `signInWithOAuth`, `signUp`, `signOut`, `resetPasswordForEmail`; subscribes to `onAuthStateChange`. *(scaffolded)*
3. **`components/RequireAuth.tsx`** — route guard that redirects to `/login` when no session; wraps the entire `/app/*` tree in `App.tsx`. *(scaffolded)*
4. **Rewrite `Login` + `Signup`; add `ForgotPassword` + `ResetPassword`** — all backed by Supabase, with Google/GitHub buttons. Remove all `localStorage.setItem("access_token", ...)`. *(Login/Signup/Forgot/Reset scaffolded)*
5. **`lib/api.ts`** — attach `Authorization: Bearer <supabase session token>` from `supabase.auth.getSession()`; on 401, refresh once then sign out. Drop the manual localStorage token logic.

### 4.4 The must-have functional flows (these must be *excellent*, not just present)

| Flow | Today | Target (10/10) |
|------|-------|----------------|
| **Sign up** | local, no email verify, `is_active=True` | Supabase signup → email verification required → org auto-created → owner role. |
| **Log in** | localStorage JWT, no guard | Supabase password + Google/GitHub OAuth; session auto-refresh; guarded routes. |
| **Forgot password** | stub (does nothing) | Supabase `resetPasswordForEmail` → email → reset page → done. |
| **Reset password** | stub (returns success) | real Supabase update on the recovery session. |
| **Email verification** | absent | enforced before app access. |
| **MFA** | absent | optional TOTP enrollment in settings. |
| **Logout** | no-op | Supabase `signOut` clears session everywhere; backend honors revocation. |
| **Team / invites** | UUID token, no expiry | expiring single-use invite → Supabase invite email → role-scoped join to org. |
| **Profile** | partial | view/edit name, avatar, country, phone; synced. |
| **Settings** | partial | notifications + preferences + security (MFA, sessions). |

### 4.5 Phase 1 exit criteria (Auth = 10/10 path)

- A new user can sign up, verify email, log in (password **and** Google/GitHub), reset a forgotten password, enable MFA, and log out — all working end-to-end.
- Every `/app/*` route is unreachable without a valid session; direct URL access redirects to login.
- Backend rejects any request without a valid Supabase JWT; tenant + role come from verified claims, not the client.
- Zero passwords or credential logic remain in our backend/DB; zero auth stub endpoints remain.
- Tests cover: token validation, profile provisioning, RBAC denial, and the invite flow.

---

## 5. Phase 2 — Functional core: profile, team, settings (Weeks 3–5)

With identity solid, make the everyday surfaces genuinely good.

- **Organizations & membership:** `organizations`, `memberships(org_id, user_id, role)`; an org is created on first owner signup; invites add memberships, not ad-hoc `company_id` writes.
- **Team management:** list/invite/remove members, change roles — all server-authorized and audit-logged; invites expire (e.g. 72h), single-use, role-scoped.
- **Profile:** complete edit (name, avatar via Supabase Storage, country, phone), synced to `profiles`.
- **Settings:** notification preferences, UI preferences, **security tab** (MFA enrollment, active sessions, sign-out-everywhere).
- **Soft-delete + audit:** add `deleted_at` and an `audit_log` table; member/role/asset changes are recorded and reversible. Stop the cascade that destroys a user's assets on delete.

**Exit criteria:** an owner can run their whole org (invite, role, remove, profile, settings) with every action authorized, audited, and recoverable.

---

## 6. Phase 3 — Platform spine (Weeks 4–8, parallel with P2)

The cross-cutting backbone that makes everything testable, observable, and scalable.

- **Tenancy model:** add `org_id` column to assets/ASM/finding/reporting rows; filter directly (kill the per-request `_company_user_ids` rebuild); add **foreign keys with `ondelete`** across ASM tables (`asm_models.py`).
- **Migrations:** adopt **Alembic**; delete `create_all()` as the schema mechanism; versioned, reversible revisions.
- **Testing harness:** `pytest` (+ httpx async) for API, `go test` (table-driven) for workers/parsers, `vitest` + React Testing Library for frontend. Bootstrap with smoke + auth + tenancy tests.
- **CI/CD:** GitHub Actions — build, lint, typecheck, unit/integration tests, **SAST** (CodeQL/Semgrep), **SCA** (dependency scan), **secret scan** (gitleaks), **container scan** (Trivy). Merge-gated.
- **Container hardening:** multi-stage, non-root `USER`, distroless/scratch final stage, **compiled Go binary** (no `go run`), **nginx** for the static frontend (no `vite preview`), `HEALTHCHECK`, pinned base by digest.
- **Observability:** Prometheus `/metrics`, OpenTelemetry tracing, Sentry error tracking, structured JSON logging across all services, **deep** health/readiness (checks DB/Redis/RabbitMQ), log shipping.
- **Resilience:** rate limiting (Redis-backed) on auth + writes; RabbitMQ prefetch/QoS + **dead-letter queue**; publisher confirms.

**Exit criteria:** every push runs the full CI gate green; images are non-root distroless; a dashboard shows request/scan metrics and traces; a poison message dead-letters instead of looping.

---

## 7. Phase 4 — ASM → 10/10 ★ PRIMARY GOAL ★ (Weeks 6–20)

This is where we win. The ASM core is already real (6/10). We take it to **industry-leading, security-audited 10/10**. Three tracks: **reliability**, **data/scale**, **feature parity**.

### 7.1 Reliability (make the engine bulletproof)
- **Crash-safe jobs:** PostgreSQL/Redis become the source of truth for job state (remove the in-memory `map[string]*Job`); ACK only after terminal success; per-step checkpoints + **resume**; stale-`RUNNING` reaper.
- **Timeouts & cancellation:** per-job and per-tool deadlines (`context.WithTimeout`); a user-facing **cancel scan**; bound nmap (`-p-` only when explicitly chosen).
- **Concurrency:** panic recovery per step; worker pool with caps; horizontal scale of consumers.

### 7.2 Data & scale (built for 100k+ assets/tenant)
- **Normalized storage** with `org_id` + proper FKs; idempotent upserts keyed by (org, discovery, asset).
- **Defensible exposure scoring:** replace the magic-number heuristic (`len(ports)*3 + 12`) with a documented, configurable model (CVSS/EPSS-weighted + asset criticality), validated on ingest, explainable in the UI.
- **Performance:** batch loads (kill the reporting N+1s), partition/archival for historical runs, indexes for the analyst filters.

### 7.3 Feature parity (close the gaps vs Defender EASM / Xpanse / Censys / ProjectDiscovery)
| Capability | Now | To 10/10 |
|------------|-----|----------|
| Subdomain/DNS/IP/port/service discovery | Real | Keep; add reliability + scale. |
| HTTP probing & banners | Real | Keep. |
| **Screenshots / visual recon** | Absent | Add (gowitness) with storage + UI gallery. |
| **Technology fingerprinting** | Absent | Add (wappalyzer-style) tech + version mapping. |
| **Ownership verification** | Absent | DNS-TXT / file-token proof before external scans. |
| **Certificate monitoring** | Inventory only | Expiry + rotation alerting. |
| **Change/delta detection** | Persisted | Operationalize: diff views + alerts on new exposure. |
| **Continuous monitoring** | Partial | Real scheduler (interval/cron) running at scale. |
| **Asset relationship graph** | Client-derived | Server-side edges API + interactive graph. |
| **Promote-to-Asset lifecycle** | Flags only | Full findings → triage → tracked-asset workflow. |
| **Cloud discovery** | Thin | Provider-credential ingestion (AWS/GCP/Azure). |

### 7.4 ASM security (it scans the internet — it must be safe)
- **SSRF/abuse controls:** validate/allow-list targets, block private/link-local/metadata ranges, require ownership proof.
- **Supply chain:** pin every scanner version + checksum; SBOM; scan images.
- **Scan governance:** per-tenant rate/scope limits, audit of every scan, legal acknowledgement of authorization.

### 7.5 Phase 4 exit criteria (ASM = 10/10)
- A tenant can: onboard a domain, prove ownership, run discovery, see subdomains/IPs/ports/services/certs/screenshots/tech with a defensible exposure score, get alerted on changes/cert-expiry, promote findings to tracked assets, and schedule continuous monitoring — all reliable under crash, cancellable, and scaling to 100k+ assets.
- An external security firm finds **no critical/high** issues in the ASM path.
- Full test coverage on the pipeline, parsers, scoring, and tenant isolation.

---

## 8. Phase 5 — Reporting rewrite (Weeks 12–18, inside P4)

The reporting code is the weakest in the repo: a **1,599-line `domain.py` monolith** with N+1 queries, append-only change rows that duplicate on replay, dedup keys missing tenant/discovery scope, raw scanner blobs persisted unsanitized — and it generates **no actual reports** (only DB rows).

- **Rewrite, don't patch.** Decompose into: an **idempotent ingestion** layer (one upsert path per entity, conflict keys include `org_id`+`discovery_id`), a **normalization/validation** layer (sanitize before persist — closes a stored-XSS vector), and a **report generation** layer.
- **Real reports:** executive summary, technical/developer detail, and customer-facing exports (PDF/CSV/JSON), scheduled and on-demand.
- **Performance:** batch queries, no per-row SELECTs, snapshot diffing in memory.

**Exit criteria:** ingestion is replay-safe and tenant-scoped; reports generate as documents (exec/dev/customer); no file over ~400 lines; covered by tests.

---

## 9. Phase 6 — Enterprise & compliance hardening (Weeks 16–26)

- **SSO (SAML/OIDC)** for enterprise tenants (Supabase enterprise SSO), SCIM provisioning.
- **Audit trail → SIEM export**, data-retention & residency controls, encryption-at-rest, TLS enforced everywhere (`sslmode=require`).
- **Real IaC:** functioning Terraform (EKS, encrypted multi-AZ RDS, remote state, backups/DR) and K8s manifests with probes/limits/HPA — replacing today's stubs.
- **SOC 2 Type II / ISO 27001 track:** threat model, runbooks, DR drills, incident response.

---

## 10. Phase 7 — VS rebuild + remaining modules (Month 7+)

Only after ASM is 10/10. Rebuild **VS** as a real scanner (worker + queue + DB persistence, plugin/template architecture, CVE/CVSS/EPSS, suppression/exceptions, evidence, re-scan, scheduling) — delete all mock data and the in-memory `scans_db`. Then sequence **BAS → Threat Intel → Incident Response → Compliance**, each held to the same 10/10 bar. Until each ships, the marketing surface says "roadmap," not "available."

---

## 11. Dimension scorecard: baseline → target, and the phase that gets us there

| Dimension | Now | Target | Driven by |
|-----------|----:|------:|-----------|
| Security | 2.5 | 10 | P0, P1, P3, P4.4, P6 |
| Auth/Identity | ~2 | 10 | **P1** |
| Architecture | 4.5 | 10 | P3, P4.1 |
| ASM maturity | 6.0 | 10 | **P4** |
| Backend | 4.0 | 10 | P1, P3 |
| Frontend | 3.5 | 10 | P1, P2 |
| Database | 4.0 | 10 | P3 |
| DevOps | 1.5 | 10 | P3 |
| Performance | 3.0 | 10 | P3, P4.2 |
| Scalability | 2.0 | 10 | P3, P4.1 |
| Reporting | 3.0 | 10 | **P5** |
| Product/UX | 3.5 | 10 | P1, P2, P4 |
| Testing | 0 | 10 | P3 (then every PR) |
| Observability | 1.5 | 10 | P3 |
| Compliance | ~1 | 10 | P6 |

---

## 12. Immediate next actions (this week)

1. ✅ **Phase 1 auth foundation scaffolded** (this session): backend Supabase JWT validation + sync + slim router; frontend supabase client, AuthContext, RequireAuth, Login/Signup/Forgot/Reset. See `docs/PHASE-1-AUTH.md`.
2. Create the Supabase project; enable Email + Google + GitHub providers; copy `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` into env.
3. Add `.gitignore`/`.dockerignore`/`.env.example`; rotate all leaked secrets.
4. Wire `RequireAuth` around `/app/*` in `App.tsx`; delete `localStorage` token code.
5. Stand up the Alembic + pytest + GitHub Actions skeleton so every subsequent change is migrated, tested, and gated.

---

*This roadmap is a living document. Update phase status and exit-criteria checkboxes as work lands. The order is deliberate: a world-class ASM is only credible on a world-class foundation.*

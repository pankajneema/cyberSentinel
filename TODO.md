# CyberSentinel — TODO: Start → ASM Complete (10/10)

Ordered, actionable checklist covering **Phase 0 → Phase 4 (ASM)**. Each item is a
concrete unit of work. Check items off as they land. Full context lives in `ROADMAP.md`.

Legend: `[x]` done · `[ ]` to do · **(BLOCKER)** must finish before dependents · ⏱ rough effort.

---

## ✅ Progress log — completed so far

**Foundation & docs**
- [x] Full enterprise audit (`cybersentinel-enterprise-audit.pdf`)
- [x] `ROADMAP.md` (0→10/10 phased plan) + this `TODO.md`
- [x] `docs/PHASE-1-AUTH.md` integration guide

**Phase 0 — security hardening (code-side done)**
- [x] `.gitignore`, `.dockerignore`, `.env.example` (backend + frontend)
- [x] Removed hardcoded fallback secrets; fail-fast config
- [x] CORS allow-list parsing fixed
- [x] Security-headers middleware + global exception handler (`utils/http_hardening.py`)
- [x] Deep `/readyz` readiness probe

**Phase 1 — Supabase auth foundation (done)**
- [x] Backend: `supabase_auth.py`, `identity_sync.py`, `tenancy_models.py`, `auth_supabase.py`, settings + main wiring
- [x] Frontend: `supabase.ts`, `AuthContext`, `RequireAuth`, Login/Signup/Forgot/Reset, api.ts token, App.tsx guard
- [x] Removed dangerous auth stub endpoints + dead frontend services
- [x] Cutover: Dashboard, Team (`/auth/me`), Invite, logout → Supabase

**Phase 3 — spine skeleton (done)**
- [x] `pytest` + first tests (CORS, secret fail-fast, JWT reject, RBAC)
- [x] GitHub Actions CI (tests, build, gitleaks, Semgrep)
- [x] Alembic scaffold

**Secret/identity hardening (done)**
- [x] Removed hardcoded Gmail password from `email.py` (env-only)
- [x] `users.hashed_password` nullable + drop migration + user-import plan (`docs/USER-MIGRATION.md`)
- [x] Signed Supabase provisioning webhook (`routes/auth_webhook.py`)

**Phase 2 — organizations & memberships (done)**
- [x] `organizations` + `member_profiles` + `org_invites` models; `/orgs/*` (members, invites, roles) RBAC + audit + soft-delete
- [x] Accept-invite wired into Invite/Login; frontend `orgs` service
- [x] **Team.tsx rewritten onto `/orgs/*`**; new **Profile** + **Settings** (MFA, sign-out-everywhere) pages

**Phase 3 — platform spine (this batch)**
- [x] Tenancy: `org_id` on assets + all ASM tables, FKs with `ondelete`, fixed destructive cascade, backfill script
- [x] Resilience: Redis rate limiting; RabbitMQ QoS + dead-letter + publisher confirms
- [x] Container hardening: all 4 Dockerfiles multi-stage + non-root; nginx frontend; compiled Go binaries; healthchecks
- [x] CI: added SCA (pip-audit/npm audit) + Trivy container scan
- [x] Observability **skeleton** (logging/Sentry/OTel/`/metrics` stubs) — full stack deferred per request
- [x] Migrations: baseline + drop-hashed-password revisions; tenancy tests

**Gap-closing pass (best level)**
- [x] Verified config hardening actually runs (CORS parse + fail-fast) — executed, not just compiled
- [x] Worker Phase 0: no-shell nmap, top-level panic recovery, job timeout + cancellation check
- [x] **Real tenant isolation**: assets route now filters by `org_id` (template for the rest)
- [x] Runnable stack: full `docker-compose.yml`, `Makefile`, `docs/RUN-LOCAL.md` with an end-to-end verify checklist

**⏳ Needs YOU (manual, can't be done from code / no network here):**
- Rotate the secret *values* in provider consoles · scrub `.env` from git history
- Create the Supabase project + fill env · run `make up`, `pytest`, `go build`, `npm run build`
- Run Alembic autogenerate + `make backfill` against a dev DB
- Walk the verify checklist in `docs/RUN-LOCAL.md` — only then are Phases 0–3 truly "done"

> Detailed per-item status is ticked inline in the phases below.

---

## PHASE 0 — Stop-the-bleed security (Week 1) — **(BLOCKER for everything)**

- [x] Add root `.gitignore` (ignore `.env`, secrets) ⏱0.25d
- [x] Add `.env.example` for backend + frontend ⏱0.25d
- [x] Add `.dockerignore` (stop baking `.env` into images) ⏱0.25d
- [x] Removed the hardcoded Gmail app password + email defaults from `notificationservice/email.py` (env-only now) ⏱0.25d
- [ ] **Rotate the actual secret values** — DB, RabbitMQ, JWT, Gmail app password — in the provider consoles ⏱0.25d · **(YOUR ACTION)**
- [ ] Remove committed `.env` files from working tree; scrub from git history (`git filter-repo`) ⏱0.5d · **(YOUR ACTION)**
- [x] Delete hardcoded fallback secrets in `config/settings.py`; fail-fast if required env missing ⏱0.25d
- [x] Fix CORS: parse `CORS_ORIGINS_URL` into a real list; never `*` + credentials (`main.py`) ⏱0.25d
- [x] Add global exception handler — stop returning `str(e)` to clients (`utils/http_hardening.py`) ⏱0.5d
- [x] Add security-headers middleware (HSTS, CSP, X-Frame-Options, X-Content-Type-Options) ⏱0.25d
- [x] Add deep readiness probe `/readyz` (checks DB + Redis) ⏱0.25d
- [x] Worker quick wins: replaced `bash -lc` nmap call with no-shell arg-slice exec (`ip.go`) ⏱0.25d
- [x] Worker quick wins: top-level `recover()` in executor `Run` + ctx-cancellation check; wired `TaskTimeoutSec` via `NewTimeoutContext` ⏱0.5d

**Exit:** no secrets in repo · CORS is an explicit list · no stack traces leak · worker survives a tool panic.

---

## PHASE 1 — Auth & Identity on Supabase (Weeks 1–3) — **(FOUNDATION / BLOCKER)**

### Backend (scaffolded ✅)
- [x] `utils/supabase_auth.py` — validate Supabase JWT (HS256/JWKS), `get_current_user`, `require_role`
- [x] `utils/identity_sync.py` — JIT provision org + owner profile on first login
- [x] `models/tenancy_models.py` — organizations, member_profiles, member_settings, audit_logs
- [x] `routes/auth_supabase.py` — `/auth/me`, `/auth/profile`, `/auth/settings`
- [x] `config/settings.py` — Supabase env keys; register router + models in `main.py`
- [x] Delete dangerous stub endpoints in `routes/auth.py` (`refresh`, `forgot/reset-password`, `magic-link`, fake `logout`) + dead frontend service fns ⏱0.5d
- [x] Drop `users.hashed_password` — made nullable + migration `0002` + export script + `docs/USER-MIGRATION.md` ⏱1d
- [x] `require_role(...)` helper available + enforced on the new identity routes; **rollout across all old write routes happens as each is migrated to Supabase `get_current_user`** ⏱(ongoing)
- [x] Supabase DB webhook → backend provisioning (`routes/auth_webhook.py`, signed, user.created/deleted) ⏱1d

### Frontend (scaffolded ✅)
- [x] `lib/supabase.ts` client + `getAccessToken()`
- [x] `contexts/AuthContext.tsx` (`useAuth`) + `components/RequireAuth.tsx`
- [x] Rewrite `Login` / `Signup`; add `ForgotPassword` / `ResetPassword` (password + Google/GitHub)
- [x] `lib/api.ts` attaches Supabase token (no localStorage JWT)
- [x] `App.tsx` — `AuthProvider` + `RequireAuth` guard on `/app/*` + new routes
- [x] Fix logout in `AppHeader` / `AppSidebar` to use Supabase `signOut`
- [x] `Invite.tsx` credential step moved to Supabase signup (removed old `access_token` write); **org-join finalization deferred to Phase 2** (needs unified memberships model) ⏱
- [x] **Migrate `Dashboard.tsx`** — removed stale localStorage token gate (route is guarded; apiFetch attaches Supabase token) ⏱0.5d
- [x] Migrate `Team.tsx` current-user read to `/auth/me` (added `getMe()` service) ⏱0.5d

### Supabase project setup
- [ ] Create project; enable Email + Google + GitHub providers ⏱0.5d
- [ ] Configure redirect URLs (`/login`, `/reset-password`, `/app/dashboard`) ⏱0.25d
- [ ] Enforce email confirmation ON ⏱0.1d
- [ ] Fill backend `.env` (`SUPABASE_URL`, `SUPABASE_JWT_SECRET`) + frontend `.env` (`VITE_SUPABASE_*`) ⏱0.25d
- [ ] `npm install` (adds `@supabase/supabase-js`); `pip install -r requirements.txt` ⏱0.1d

### Must-have functional flows verified end-to-end
- [ ] Sign up → email verify → sign in ⏱
- [ ] Login via password AND Google/GitHub ⏱
- [ ] Forgot password → email → reset → login ⏱
- [ ] Logout clears session everywhere ⏱
- [ ] Direct-visit `/app/*` while signed out → redirect to `/login` ⏱
- [ ] (Optional) MFA/TOTP enrollment in settings ⏱1d

**Exit:** all auth flows work · every `/app/*` route guarded · backend trusts only verified claims · zero auth stubs left · tests cover token validation, provisioning, RBAC, invite.

---

## PHASE 2 — Functional core: org, team, profile, settings (Weeks 3–5)

- [x] `organizations` + `member_profiles(org_id, supabase_user_id, role)` as the tenancy root (`models/tenancy_models.py`) ⏱1d
- [x] Team backend: list / remove members + change roles, server-authorized via `require_role` (`routes/orgs.py`) ⏱2d
- [x] Invites: expiring (72h), single-use, role-scoped (`org_invites` + create/list/revoke/accept) + email send ⏱1d
- [x] Accept-invite finalized: `Invite.tsx` + `Login.tsx` (`?invite=`) call `/orgs/invites/accept` → org-join ⏱
- [x] Soft-delete (`deleted_at`) + `audit_log` writes on member/role/invite changes ⏱1.5d
- [x] Frontend `orgs` service (`lib/services/orgs.ts`) + Phase 2 tests (`test_orgs.py`) ⏱
- [x] **Rewrote `Team.tsx`** onto `/orgs/*` (members, invite, role change, remove, pending invites; RBAC-aware) ⏱1.5d
- [x] Profile page (`Profile.tsx`) — edit name/country/phone/avatar URL → `/auth/profile` (Storage upload = follow-up) ⏱1.5d
- [x] Settings page (`Settings.tsx`) — notifications + preferences + security tab (MFA enroll, sign-out-everywhere) ⏱2d
- [x] Removed the destructive cascade — `Asset.user_id` is now `ondelete=SET NULL`; tenant lives on `org_id` ⏱0.5d

**Exit:** an owner can fully run their org (invite, role, remove, profile, settings), every action authorized, audited, recoverable.

---

## PHASE 3 — Platform spine (Weeks 4–8, parallel with P2)

### Tenancy & data
- [x] Added `org_id` column to assets + all ASM tables (FK → organizations) ⏱2d
- [x] Added FKs with `ondelete` across `asm_models.py` (11 `asm_discovery_id` FKs + cascade) ⏱1d
- [x] Tenancy helper `scope_to_org`/`require_org` + backfill script (`scripts/backfill_org_id.py`) ⏱
- [x] **assets route migrated** to Supabase auth + direct `org_id` filtering (the reference pattern) ⏱
- [ ] Apply the same pattern to the remaining routes (asm.py, vs.py, …); remove `_company_user_ids` ⏱2d · *(per-route, ongoing)*

### Migrations
- [x] Adopt **Alembic** — scaffold added (`alembic.ini`, `migrations/env.py`, async, wired to models) ⏱1.5d
- [x] Baseline revision `0001_baseline` + `0002_drop_hashed_password` scaffolded (autogen/stamp documented) ⏱0.5d · *(autogen needs a dev DB)*
- [x] Backfill script for `org_id` on existing rows (`scripts/backfill_org_id.py`) ⏱1d

### Testing harness (then enforce on every PR)
- [x] `pytest` + asyncio bootstrapped; first tests: CORS parse, secret fail-fast, JWT reject, RBAC deny/allow ⏱2d
- [x] Tenancy unit tests (`test_tenancy.py`: org guard, SET NULL FK, org_id columns) ⏱
- [ ] Expand: full API integration tests (httpx) against a test DB ⏱2d
- [ ] `go test` table-driven tests for worker pipeline + output parsers ⏱3d
- [ ] `vitest` + React Testing Library for critical components ⏱2d

### CI/CD (GitHub Actions, merge-gated)
- [x] Build + lint + typecheck + unit tests (backend pytest, frontend build, go build/vet) ⏱1d
- [x] SAST (Semgrep) — report-only until baseline triaged ⏱0.5d
- [x] Secret scan (gitleaks) ⏱0.25d
- [x] SCA dependency scan (pip-audit + npm audit) ⏱0.5d
- [x] Container scan (Trivy on the API image) ⏱0.5d

### Container hardening
- [x] Multi-stage, non-root `USER` (all 4 Dockerfiles); slim/nginx-unprivileged runtimes ⏱2d
- [x] Compiled Go binaries (no `go run`); nginx for static frontend (no `vite preview`) ⏱1d
- [x] `HEALTHCHECK` added; base-image digest-pinning noted as a one-line prod step ⏱0.5d

### Observability & resilience
- [x] **Skeleton** (`utils/observability.py` + `docs/OBSERVABILITY.md`): logging + optional Sentry/OTel + `/metrics` stub ⏱
- [x] Deep health/readiness (`/readyz` checks DB + Redis) ⏱0.5d
- [x] Redis-backed rate limiting on auth + write endpoints (`utils/rate_limit.py`) ⏱1d
- [x] RabbitMQ prefetch/QoS + dead-letter queue + publisher confirms (`queue.go`, `start.go`) ⏱1d
- [ ] *(Full Prometheus/OTel/Sentry/log-shipping — deferred, skeleton only for now)* ⏱

**Exit:** full CI gate green on every push · non-root distroless images · metrics/traces visible · poison messages dead-letter.

---

## PHASE 4 — ASM → 10/10 (Weeks 6–20) — **★ PRIMARY GOAL ★**

### 4A. Reliability (bulletproof engine)
- [ ] Move job state to PostgreSQL/Redis; remove in-memory `map[string]*Job` ⏱3d
- [ ] ACK only after terminal success; stop ACKing on HTTP error (`consumer/asm/job.go`) ⏱1d
- [ ] Per-step checkpoints + **resume** from last completed step ⏱3d
- [ ] Stale-`RUNNING` job reaper ⏱1d
- [ ] Per-job + per-tool timeouts (`context.WithTimeout`); user-facing **cancel scan** ⏱2d
- [ ] Panic recovery per step; worker pool with concurrency caps ⏱1.5d
- [ ] Remove `RegisterJob` DB I/O held under global mutex ⏱1d

### 4B. Data & scale (100k+ assets/tenant)
- [ ] Normalized storage with `org_id` + proper FKs + idempotent upserts (org,discovery,asset) ⏱3d
- [ ] Replace magic-number exposure score with documented CVSS/EPSS + asset-criticality model ⏱4d
- [ ] Make scoring explainable in the UI ⏱1.5d
- [ ] Batch loads (kill reporting N+1s); indexes for analyst filters ⏱2d
- [ ] Partition/archival strategy for historical runs ⏱2d

### 4C. Feature parity (vs Defender EASM / Xpanse / Censys / ProjectDiscovery)
- [ ] **Screenshots / visual recon** (gowitness) + storage + UI gallery ⏱3d
- [ ] **Technology fingerprinting** (tech + version mapping) ⏱3d
- [ ] **Ownership verification** (DNS-TXT / file-token) before external scans ⏱2d
- [ ] **Certificate expiry + rotation alerting** ⏱2d
- [ ] **Change/delta detection** operationalized — diff views + alerts on new exposure ⏱3d
- [ ] **Continuous monitoring** — real interval/cron scheduler at scale ⏱3d
- [ ] **Asset relationship graph** — server-side edges API + interactive graph ⏱3d
- [ ] **Promote-to-Asset lifecycle** — findings → triage → tracked-asset workflow (end-to-end) ⏱3d
- [ ] **Cloud discovery** — provider-credential ingestion (AWS/GCP/Azure) ⏱4d

### 4D. ASM security (it scans the internet — must be safe)
- [ ] Validate/allow-list scan targets; block private/link-local/metadata ranges (SSRF, audit C-3) ⏱2d
- [ ] Require ownership proof before scanning external assets ⏱1d
- [ ] Pin every scanner version + checksum; generate SBOM; scan images ⏱2d
- [ ] Per-tenant scan rate/scope limits + audit of every scan + authorization acknowledgement ⏱2d

### 4E. ASM quality gates
- [ ] Full test coverage: pipeline, parsers, scoring, tenant isolation ⏱4d
- [ ] External security review of the ASM path → no critical/high findings ⏱(vendor)
- [ ] Load test: discovery + storage at 100k+ assets/tenant ⏱2d

**Exit (ASM = 10/10):** a tenant can onboard a domain, prove ownership, run discovery, see subdomains/IPs/ports/services/certs/screenshots/tech with a defensible exposure score, get change + cert-expiry alerts, promote findings to tracked assets, and schedule continuous monitoring — reliable under crash, cancellable, scaling to 100k+ assets, with no critical/high security findings.

---

## Reporting (runs inside Phase 4 — needed for ASM to be "complete")

- [ ] Rewrite `reporting/asm/assets/domain.py` (1,599-line monolith) into ingestion / normalization / generation layers ⏱5d
- [ ] Idempotent ingestion — conflict keys include `org_id` + `discovery_id` (replay-safe) ⏱2d
- [ ] Sanitize/validate scanner blobs before persist (closes stored-XSS vector) ⏱1.5d
- [ ] Generate real reports: executive / developer / customer (PDF/CSV/JSON), scheduled + on-demand ⏱4d
- [ ] No file over ~400 lines; covered by tests ⏱

**Exit:** ingestion is replay-safe and tenant-scoped · reports generate as documents · tested.

---

### Milestones
1. **M1 — Secure foundation** (P0+P1 done): auth excellent, no critical security findings.
2. **M2 — Solid platform** (P2+P3 done): tenancy, migrations, CI, tests, observability green.
3. **M3 — ASM 10/10** (P4 + reporting done): world-class, security-audited ASM shipped.

*Only after M3 do we move to VS and the remaining modules. One great module first.*

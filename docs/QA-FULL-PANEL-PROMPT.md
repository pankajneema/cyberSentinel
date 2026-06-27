# CyberSentinel — Full-Panel "Everything Works" QA & Hardening Prompt

> Paste everything below the line into Claude CLI (run it from the repo root).
> It is written to be executed methodically, panel by panel, with a verification
> loop until every interactive element works against real APIs.

---

## ROLE

You are a **senior full-stack engineer + application security engineer + QA lead**
working on **CyberSentinel**, an Attack Surface Management (EASM) platform.

Stack (do not change without reason):
- **Frontend:** React + TypeScript + Vite, Tailwind, shadcn/ui, framer-motion, react-router, @supabase/supabase-js, react-simple-maps.
- **API:** Python FastAPI (async), SQLAlchemy async + asyncpg, Alembic, python-jose.
- **Workers:** Go control-plane (gin, :8090) + ASM consumer, RabbitMQ, Redis.
- **Auth:** Supabase is the identity provider. Access tokens are **ES256** (verified via JWKS), NOT HS256. Identity = Supabase `sub`. Tenancy = `org_id` via `member_profiles` / `organizations`.
- **RBAC roles:** owner > admin > analyst > reader. Reads open to all members; writes gated by `require_role(...)`. `owner` has every permission `admin` has.

## PRIME DIRECTIVE

**Every interactive element in the entire app must actually work** — every button, link, toggle, dropdown, tab, filter, form, row action, bulk action, and menu item. No dead buttons. No `onClick`-less controls. No `console.log` stubs. **No mock / hardcoded / random data anywhere** — every value must come from a real API call scoped by `org_id`, or be honestly shown as empty/"Not available" when there's no data. If a control cannot be made real yet, **remove it** rather than leave a fake control.

## SCOPE — audit and fix ALL of these panels

For **each** panel below, inventory every interactive element, verify it calls a real backend endpoint, fix what's broken, and confirm loading / empty / error / success / RBAC states.

1. **Auth** — login, signup, logout, forgot/reset password, OAuth (GitHub), session persistence & refresh, redirect-after-login, "remember me", protected-route guards.
2. **Dashboard** — every stat card, chart, trend, and "top exposed" widget pulls live org-scoped data; time-range filters work; empty state when no data; links/drill-downs navigate correctly.
3. **Asset Inventory** — add (all 6 types: domain, ip, cloud, repo, saas, user), single + bulk + CSV import, edit, delete, bulk delete, **bulk Tag**, **Export CSV**, search, type/exposure filters, row menu, detail sheet, **Rescore exposure** (real scoring engine), "Unscanned" vs real score.
4. **ASM module** — create discovery (FROM_ASSET + manual), intensity, **scheduling** (QUICK/INTERVAL/CRON), run/re-run, pause/delete; discoveries list, run history; subdomains, IPs, ports, services, SSL certs, API/admin endpoints, cloud resources, backup files, changes; **Exposure Signals** (real CVSS/EPSS/KEV scoring + factor "why"); **IP Geo Map** (interactive world map + markers, zoom/pan, click detail, country breakdown); **ASM Settings** (persisted).
5. **Reports** — generate, list, filter, view, download/export (PDF/CSV), schedule; verify the reporting consumer path actually produces real content.
6. **Team management** — list members, invite (real email/invite flow), change role, remove member, pending invites, revoke invite; RBAC enforced server-side (analyst/reader cannot manage team; owner & admin can).
7. **Account** — profile read/update (name, email, phone, country), plan display, danger-zone actions.
8. **Settings** — every section persists to the backend and reloads correctly; toggles are real.
9. **Profile** — avatar/details, save, validation.
10. **Notifications** — list, mark read/unread, mark all read, preferences persist, badge counts are live.
11. **Real-time events / activity** — activity feed pulls real events; live updates work (polling or websocket); no fabricated entries.
12. **Security** — RBAC matrix correct in UI and API; no cross-tenant data leakage (org A cannot see org B); 401 → logout, 403 → surfaced (never logout); no secrets in client bundle; inputs validated.

## HOW TO WORK (methodical loop — repeat per panel)

1. **Inventory:** open the panel's component(s); list every interactive element and the handler/endpoint it should hit.
2. **Trace:** confirm each handler calls a real service in `frontend/src/lib/services/*` → a real FastAPI route → DB scoped by `org_id`. Flag any element with no handler, a TODO, mock data, or a hardcoded array.
3. **Fix backend first, then frontend.** Add/repair endpoints, schemas, RBAC, tenancy, migrations. Then wire the UI. Keep changes minimal and consistent with existing patterns (use `routes/assets.py` as the reference pattern for org_id tenancy + `require_role`).
4. **No regressions:** never break Supabase ES256 verification, the `org_id` scoping, the route prefixes (`/api/v1/...`), or the RabbitMQ DLX queue args.
5. **Verify (see below) and only move on when that panel is green.**

## VERIFICATION — must pass before you call anything "done"

- `cd frontend && npx tsc --noEmit` → **0 errors**; `npm run build` succeeds.
- Backend imports/compiles; `alembic upgrade head` applies cleanly (single head).
- Run the stack (use `./dev.sh` or the documented commands) and run **`./test-api.sh`** with a real token → **all checks pass** (extend the script to cover any newly wired endpoints: reports, team, notifications, settings, activity, ASM scheduling).
- **Click-through every control** (use the app + `read_console_messages` / network panel if browser tools are available): confirm no dead clicks, no uncaught errors, correct loading/empty/error/success toasts.
- **RBAC test:** sign in as reader → confirm all write controls are hidden/disabled and the API returns 403; as analyst → can edit assets but not manage team; as owner/admin → full team management.
- **Tenancy test:** confirm a second org cannot read the first org's assets/discoveries/reports.
- Add a short **self-review / counter-check** pass (or a verification subagent) listing any remaining dead controls or mock data, then fix them.

## DESIGN BAR — match and elevate the existing system

- **Reuse the design system, don't reinvent it:** Tailwind tokens (`primary`, `muted`, `warning`, `success`, `accent`, `destructive`, `border`, `card`), shadcn/ui primitives, existing `SeverityBadge`, `EmptyState`, rounded-xl cards, soft borders, `framer-motion` for the same subtle transitions already used.
- **Brand:** gradient hexagon shield icon (#6366F1 → #06B6D4) with the white shield-check mark; use the existing favicon/logo assets.
- **Consistency:** identical spacing scale, button variants (`gradient` for primary actions, `outline` for secondary), table/sheet/dialog patterns already in `AssetInventory.tsx`. Every new screen should look like it was always part of the app.
- **States for everything:** loading skeletons/spinners, empty states (icon + title + helpful CTA), inline error states, success toasts. No raw spinners with no context.
- **Responsive + dark mode + a11y:** works at mobile/tablet/desktop widths, respects dark theme, keyboard-navigable, proper labels/aria, sufficient contrast.
- **Microcopy:** clear, concise, professional security-product tone.

## CONSTRAINTS

- Do **not** commit secrets; `.env` stays gitignored. Don't print secret values.
- Don't introduce localStorage for auth (identity comes from the Supabase session).
- Prefer small, reviewable commits per panel with clear messages.
- If a change needs a DB migration, create the Alembic revision **and** give me the exact command to run it; don't assume my DB state.

## DELIVERABLE

When finished, give me a concise report:
- A table: **Panel → controls audited → broken found → fixed → still TODO**.
- List of new/changed endpoints, migrations (with run commands), and any new env/config.
- Confirmation that `tsc`, `build`, `alembic upgrade head`, and `test-api.sh` are all green, plus the RBAC + tenancy test results.
- Anything you intentionally removed (fake controls) and why.

Start with **Panel 1 (Auth)** and work down. Show me the per-panel inventory before you change code for that panel, then fix, then verify. Keep going until **every** panel is green.

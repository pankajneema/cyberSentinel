# Frontend `[Module: Core-Platform + ASM]`

> The React SPA — the entire user-facing product. Path: `frontend/` (skip `node_modules`, `dist`).

**Related:** [Overview](overview.md) · [API Guide](../04_infra_and_api_guide/api_guide.md) · [Panel Guide](../02_glossary_and_panel_guide/panel_guide.md) · [Glossary](../02_glossary_and_panel_guide/domain_glossary.md)

---

## Table of Contents
1. [Purpose & stack](#1-purpose--stack)
2. [Architecture](#2-architecture)
3. [Routing](#3-routing)
4. [The app shell](#4-the-app-shell)
5. [API layer](#5-api-layer)
6. [Auth & session](#6-auth--session)
7. [Realtime](#7-realtime)
8. [RBAC in the UI](#8-rbac-in-the-ui)
9. [Component map](#9-component-map)
10. [Why built this way / trade-offs](#10-why-built-this-way--trade-offs)
11. [Known limitations / tech debt](#11-known-limitations--tech-debt)
12. [How this connects to other modules](#12-how-this-connects-to-other-modules)

---

## 1. Purpose & stack
Render the product and hold **no security logic** — the backend re-enforces everything. Stack (`package.json`):
- **React 18.3 + TypeScript 5.8**, built with **Vite 5.4** (`@vitejs/plugin-react-swc`). Dev server on `:8080`, path alias `@` → `./src`.
- **Router:** react-router-dom 6.30. **Server state:** @tanstack/react-query 5.83 (mounted, but most ASM panels use raw `useEffect`+fetch). **Auth SDK:** @supabase/supabase-js 2.45.
- **UI:** shadcn/ui (Radix) + Tailwind 3.4, class-variance-authority. **Charts/maps:** recharts, react-simple-maps. **Forms:** react-hook-form + zod. **Toasts:** sonner. **Icons:** lucide-react. **Animation:** framer-motion.
- Scripts: `dev`, `build`, `build:dev`, `lint`, `preview`. **No test suite configured.** Deploy artifacts: `Dockerfile`, `nginx.conf`, `vercel.json`.
- Env (names only): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

> Scaffolded via Lovable (`package.json` name `vite_react_shadcn_ts`, dev-only `lovable-tagger`).

## 2. Architecture
```
src/App.tsx              → router: public zone + protected /app zone
src/layouts/AppLayout.tsx→ shell: RealtimeProvider + SidebarProvider + header + sidebar + <Outlet>
src/pages/               → route components (public marketing + app/*)
src/components/
  ui/                    → shadcn primitives
  landing/               → marketing site
  app/                   → AppSidebar, AppHeader, LiveScanIndicator, LiveScanPopup
  asm/                   → the ASM feature set (see Panel Guide)
src/lib/
  api.ts                 → apiFetch wrapper (base ${VITE_API_URL}/api/v1, Bearer JWT)
  services/*.ts          → typed API clients (asm, assets, reports, tasks, ...)
  supabase.ts            → Supabase client + hybrid remember-me storage
  permissions.ts         → RBAC helpers
src/contexts/AuthContext.tsx → session provider
src/hooks/useRealtime.tsx    → WebSocket client
```

## 3. Routing
`src/App.tsx` — two zones:
- **Public:** `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/pricing`, `/about`, `/contact`, `/services`, `/invite/:token`, `/modules/:moduleId`.
- **Protected** (`<RequireAuth>` → `<AppLayout>`, gated on a valid Supabase session, redirect to `/login` preserving `location.state.from`): `/app` & `/app/dashboard`, `/app/team`, `/app/assets`, `/app/asm`, `/app/vs`, `/app/services`, `/app/marketplace`, `/app/reports`, `/app/account`, `/app/profile`, `/app/settings`, `*` → NotFound.

Unrouted page files exist (Blog, Career, CookiePolicy, PrivacyPolicy, TermsOfService, a duplicate top-level `pages/Services.tsx`) — not wired into `App.tsx`.

## 4. The app shell
`AppLayout.tsx` wraps content in `RealtimeProvider` + `SidebarProvider`, with a fixed left `AppSidebar` (collapsible 260px/72px), top `AppHeader`, main `<Outlet>`, and global `LiveScanIndicator` + `LiveScanPopup` overlays. `AppSidebar` nav: Dashboard, Team Management, Asset Inventory, **ASM** (badge "Live"), **Vulnerability Scans** (badge "Live"), Services, Marketplace, Reports; bottom Account + Help. Nav is **role-filtered** (analyst/reader don't see Marketplace/Services). Identity via `getMe()`, plan via `getCurrentPlan()`.

## 5. API layer
`src/lib/api.ts` — base `${VITE_API_URL}/api/v1`. Single `apiFetch<T>(path, init)`:
- Attaches `Authorization: Bearer <supabase access_token>`.
- **401** → `supabase.auth.signOut()` + redirect `/login`. **403** → throws a permission error (does **not** log out — RBAC). Other non-OK → throws body text.
- Exports generic `Paginated<T>` (`items, total, page, page_size`) and re-exports all service modules.

`src/lib/services/asm.ts` — the ASM surface: discoveries CRUD + lifecycle (`/run`,`/pause`,`/resume`,`/stop`), dashboards, findings tables (subdomains/ips/ports/services/ssl/api-endpoints/cloud-resources/admin-endpoints/backup-files/changes/repo-findings/saas-apps/user-accounts), runs, exposure, settings. Standard list params: `page`, `page_size`, `q`, `sort_by`, `sort_dir`, `discovery_id`.

## 6. Auth & session
`src/lib/supabase.ts` — Supabase is the single identity source, with a **hybrid storage adapter** for "Remember me" (token → `localStorage` if remember, else `sessionStorage`; preference key `cs.auth.remember`). `src/contexts/AuthContext.tsx` subscribes to `onAuthStateChange` and exposes `signInWithPassword` (remember flag), `signInWithOAuth('google'|'github')`, `signUp`, `signOut`, `sendPasswordReset`, `updatePassword`. **Rule:** components must not call `supabase.auth` directly — go through the context.

## 7. Realtime
`src/hooks/useRealtime.tsx` — WebSocket to `${API}/ws/realtime`, JWT passed as subprotocol `["cybersentinel-auth", token]`, 25s heartbeat, capped-backoff reconnect. Drives `LiveScanPopup` (cards keyed by `discovery_id`, added on `scan.started`, removed on `scan.completed|failed|stopped`) and live indicators. Backend contract: [Notification Service §4](notificationservice.md#4-realtime-transport-frontend-contract).

## 8. RBAC in the UI
`src/lib/permissions.ts` — roles `owner > admin > analyst > reader`; helpers `can.write` (≥analyst), `can.manageTeam` (≥admin), `can.manageOrg` (owner). **UI-only gating** — the backend re-enforces every action, so a bypassed UI check still fails server-side.

## 9. Component map
Every ASM screen and its fields — including where each value comes from (API → service → DB) — is documented in the [Panel Guide](../02_glossary_and_panel_guide/panel_guide.md). Deleted components (folded elsewhere): `asm/ASMReports.tsx`, `asm/HumanAttackSurface.tsx`, `asm/Vulnerabilities.tsx`.

## 10. Why built this way / trade-offs
[INFERRED] A Vite + shadcn SPA was chosen for fast iteration and a consistent design system; Supabase-on-the-client removes auth UI from the backend's plate.
- **Pro:** fast dev loop, accessible Radix primitives, one design language, JWT auth handled client-side.
- **Con:** react-query is under-used (raw fetch forgoes caching/retry/invalidation); no test suite; a runtime CDN dependency in the Geo Map; superadmin paths effectively unreachable.

## 11. Known limitations / tech debt
- **Marketplace has no backend** — catalog is a preview; "Install" toasts "Coming soon."
- **Exposure Trend chart** reads `exposure_history` if present (backend doesn't persist snapshots yet) → honest empty state; accessed via `(asm as any)` (type gap).
- **Discovery "Run Now"/"Stop" actions commented out**; `handleStopDiscovery` PATCHes to `PAUSED` rather than calling `/stop`.
- **Running-scan progress bars are hardcoded animations**, not real backend progress.
- **No test suite.** **react-query under-used.** **Geo Map** loads topojson from `cdn.jsdelivr.net` at runtime (air-gap concern).
- **Superadmin UI unreachable** (`is_superadmin` never populated; Marketplace/Services hardcode `false`). `[NEEDS CONFIRMATION FROM DEV]`
- Frontend re-exports service modules (`auth`, `profile`, `team`) whose backend routes were deleted — confirm all resolve. `[NEEDS CONFIRMATION FROM DEV]`

## 12. How this connects to other modules
- **→ API service:** all `/api/v1` REST + `/ws/realtime`. **→ Supabase:** login/OAuth directly.
- **New modules** add a page under `pages/app/`, a route in `App.tsx`, a nav item in `AppSidebar`, and a service client in `lib/services/`. Follow the ASM page's tabbed-workspace pattern (`pages/app/ASM.tsx`).

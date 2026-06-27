# Phase 1 — Supabase Auth: Integration Guide

This is the wiring guide for the Supabase-auth foundation scaffolded in this change.
**Supabase owns all authentication; PostgreSQL stays the source of truth for app data.**

## What was added

**Backend (`backend/api_service/`)**
- `utils/supabase_auth.py` — validates Supabase JWTs (HS256 secret or JWKS/RS256), exposes `get_current_user` + `require_role(...)` dependencies.
- `utils/identity_sync.py` — just-in-time provisioning: creates an org + owner profile on a user's first authenticated request; idempotent thereafter.
- `models/tenancy_models.py` — `organizations`, `member_profiles`, `member_settings`, `audit_logs` (keyed by Supabase `sub`).
- `routes/auth_supabase.py` — `GET /auth/me`, `PATCH /auth/profile`, `GET/PUT /auth/settings`.
- `config/settings.py` — added `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
- `main.py` — registers the new router + tenancy models.

**Frontend (`frontend/src/`)**
- `lib/supabase.ts` — the Supabase client + `getAccessToken()`.
- `contexts/AuthContext.tsx` — session state + typed auth helpers (`useAuth()`).
- `components/RequireAuth.tsx` — route guard.
- `pages/Login.tsx`, `Signup.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx` — all Supabase-backed (password + Google/GitHub).
- `lib/api.ts` — now attaches the Supabase session token (no more localStorage JWT).
- `App.tsx` — wraps the app in `<AuthProvider>` and guards `/app/*` with `<RequireAuth>`.

## Setup steps

### 1. Create the Supabase project
- New project at supabase.com → **Authentication → Providers**: enable **Email**, **Google**, **GitHub** (add OAuth client IDs/secrets).
- **Authentication → URL Configuration**: add your site URL and redirect URLs (`/login`, `/reset-password`, `/app/dashboard`).
- **Authentication → Email**: keep "Confirm email" ON (enforces verification).
- Copy from **Project Settings → API**: `Project URL`, `anon` key, and the **JWT secret** (Settings → API → JWT Settings).

### 2. Backend env (`backend/api_service/.env`)
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_JWT_SECRET=<project jwt secret>          # HS256 projects
# SUPABASE_SERVICE_ROLE_KEY=<service role key>    # only for admin/invite actions
```
Install deps (already in requirements): `pip install -r requirements.txt` (needs `python-jose`, `httpx`).

### 3. Frontend env (`frontend/.env`)
```
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
Install the SDK: `npm install` (now includes `@supabase/supabase-js`).

### 4. Database
The new tables register with the existing `create_all()` path on startup (Phase 3 will move this to Alembic). On first boot they are created automatically.

## How it works (request flow)
1. The SPA authenticates against Supabase (`supabase-js`), which holds + auto-refreshes the session.
2. `api.ts` attaches the Supabase access token as `Authorization: Bearer`.
3. The backend validates the JWT, extracts `sub/email/role`, and **provisions/syncs** the org + profile.
4. `get_current_user` returns a `CurrentUser` whose `org_id`/`role` come from verified state — never from the client.
5. Write endpoints add `Depends(require_role("owner","admin",...))` for server-side RBAC.

## Migration / cleanup TODOs (tracked in ROADMAP Phase 1–3)
- [ ] Delete the legacy stub endpoints in `routes/auth.py` (`refresh`, `forgot-password`, `reset-password`, `magic-link`, fake `logout`) and the local `signup`/`login` once the frontend is fully cut over.
- [ ] Drop `users.hashed_password`; migrate existing users to Supabase (invite/import).
- [ ] Backfill `org_id` onto assets/ASM/reporting rows and add FKs (Phase 3).
- [ ] Set `app_metadata.role` in Supabase for elevated roles (owner/admin) via a secured admin action using the service-role key.
- [ ] Remove the `.env` files from the tree and rotate all secrets (Phase 0).
- [ ] Add tests: JWT validation, provisioning, RBAC denial, invite flow.

## Quick verification
- Sign up → receive verification email → verify → sign in. ✅
- Visit `/app/dashboard` while signed out → redirected to `/login`. ✅
- `GET /api/v1/auth/me` with a valid token returns your profile + org + role. ✅
- Forgot password → email → `/reset-password` → new password works. ✅

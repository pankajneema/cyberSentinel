# Run & verify locally

Because the auth + tenancy changes can only be truly validated against a running
Supabase project + database, here is the exact path to bring everything up and
verify it end-to-end. Commands assume the repo root.

## 0. Prerequisites
- Docker + Docker Compose, Node 20, Python 3.11, Go 1.24
- A Supabase project (Email + Google + GitHub providers enabled)

## 1. Configure env (no secrets in git)
```bash
cp backend/api_service/.env.example backend/api_service/.env
cp frontend/.env.example frontend/.env
# Create backend/workers/.env with POSTGRESQL_URL + RABBITMQ_URL.
# Fill: DATABASE_URL, SUPABASE_URL, SUPABASE_JWT_SECRET, CORS_ORIGINS_URL,
#       POSTGRES_PASSWORD, REDIS_PASSWORD, RABBITMQ_PASSWORD, VITE_SUPABASE_*.
```

## 2. Bring up the stack
```bash
make up        # docker compose up -d --build  (postgres, redis, rabbitmq, api, workers, reporting, frontend)
make logs      # watch it boot
```
- API: http://localhost:8000  (`/health`, `/readyz`, `/docs`)
- Frontend: http://localhost:8080

## 3. Database schema
First run uses `create_all()` automatically. To move onto migrations:
```bash
make stamp     # mark an existing DB at the baseline
# or, on a fresh dev DB, autogenerate the real baseline:
cd backend/api_service && alembic revision --autogenerate -m "baseline" && alembic upgrade head
make backfill  # fill org_id on any legacy rows
```

## 4. Run the test suites
```bash
# Backend
cd backend/api_service && pip install -r requirements.txt pytest pytest-asyncio && pytest
# Go workers
cd backend/workers && go build ./... && go test ./...
# Frontend
cd frontend && npm ci && npm run build
```

## 5. Verify the flows (the real "done" check)
- [ ] Sign up → receive verification email → verify → sign in (password)
- [ ] Sign in with Google and with GitHub
- [ ] Forgot password → email → `/reset-password` → new password works
- [ ] Visit `/app/dashboard` while signed out → redirected to `/login`
- [ ] `GET /api/v1/auth/me` returns your org + role
- [ ] Invite a teammate (Team page) → they accept via the link → appear as a member
- [ ] Create an asset, then confirm a *different* org cannot see it (tenant isolation)
- [ ] Hit an auth endpoint >10x/min → 429 (rate limit)
- [ ] Kill a worker mid-scan → job is not lost; a poison message lands in `<queue>.dlq`

When every box above is checked, Phases 0–3 are verified — not before.
```

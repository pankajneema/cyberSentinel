import sys
from pathlib import Path
import uvicorn

# Ensure backend root is on sys.path so sibling modules resolve (e.g., notificationservice)
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config.settings import settings
from utils.database import init_db, close_db 
from utils.redis_client import  close_redis
from utils.queue import close_queue, get_queue_connection
from utils.clickhouse_client import close_clickhouse, get_clickhouse

# Import all routes
from routes import auth, users, profile, accounts, billing, services, asm, vs, settings_route, activity, assets, tasks, team, marketing, reports, notifications
from routes import auth_supabase  # Supabase-era identity router (Phase 1)
from routes import auth_webhook    # Supabase provisioning webhook
from routes import orgs            # Phase 2: organizations & memberships
from models import marketing_models  # ensure marketing tables are registered
from models import tenancy_models   # ensure organizations/member_profiles tables are registered
from models import notification_models  # ensure notifications tables are registered

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Core API Service - All business logic and routes"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,   # explicit allow-list (never "*")
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security headers + global exception handler (audit M-1 / H-6).
from utils.http_hardening import install_hardening
install_hardening(app)

# Redis-backed rate limiting on auth + write endpoints (audit S-3).
from utils.rate_limit import install_rate_limit
install_rate_limit(app)

# Observability skeleton (logging + optional Sentry/OTel + /metrics stub).
from utils.observability import install_observability
install_observability(app)


# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    """Initialize connections on startup"""
    try:
        await init_db()
    except Exception as e:
        print(f"Warning: Database initialization failed: {e}")
    
    # Initialize other connections (optional)
    try:
        from utils import get_redis, get_clickhouse, get_queue_connection
        # await get_redis()
        # get_clickhouse()
        # get_queue_connection()
    except Exception as e:
        print(f"Info: Some optional connections not available: {e}")

    # Recurring-discovery scheduler (re-runs INTERVAL discoveries when due).
    try:
        import asyncio
        from utils.scheduler import scheduler_loop
        app.state.scheduler_task = asyncio.create_task(scheduler_loop())
    except Exception as e:
        print(f"Warning: scheduler not started: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Close connections on shutdown"""
    task = getattr(app.state, "scheduler_task", None)
    if task:
        task.cancel()
    await close_db()
    await close_redis()
    await close_queue()
    await close_clickhouse()

# ==================== ROOT ====================

@app.get("/")
async def root():
    return {"service": "api-service", "status": "running", "version": "1.0.0"}

@app.get("/health")
async def health():
    """Liveness: process is up."""
    return {"status": "healthy"}


@app.get("/readyz")
async def readyz():
    """Readiness: verify critical dependencies before serving traffic."""
    checks: dict[str, str] = {}
    ok = True

    # Database
    try:
        from sqlalchemy import text
        from utils.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:  # noqa: BLE001
        checks["database"] = "down"
        ok = False

    # Redis (best-effort)
    try:
        from utils.redis_client import get_redis
        client = await get_redis()
        await client.ping()
        checks["redis"] = "ok"
    except Exception:  # noqa: BLE001
        checks["redis"] = "degraded"

    status_code = 200 if ok else 503
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=status_code, content={"ready": ok, "checks": checks})

# ==================== REGISTER ALL ROUTES ====================

# --- Identity (Supabase era) ---
app.include_router(auth_supabase.router)  # /auth/me, /auth/profile, /auth/settings
app.include_router(auth_webhook.router)   # /auth/webhook/supabase (provisioning)
app.include_router(orgs.router)           # /orgs/* (members, invites, roles)

# --- Product modules ---
app.include_router(billing.router)
app.include_router(services.router)
app.include_router(asm.router)
app.include_router(vs.router)
app.include_router(vs.vs_router)
app.include_router(activity.router)
app.include_router(assets.router)
app.include_router(reports.router)
app.include_router(notifications.router)
app.include_router(tasks.router)
app.include_router(marketing.router)

# --- REMOVED legacy routers (dead + insecure; superseded by Supabase auth + /orgs).
# users.router carried a cross-tenant IDOR (audit C-2); auth/profile/accounts/
# settings_route/team are unused by the frontend. Files kept but not mounted.
# app.include_router(auth.router)
# app.include_router(users.router)
# app.include_router(profile.router)
# app.include_router(accounts.router)
# app.include_router(settings_route.router)
# app.include_router(team.router)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

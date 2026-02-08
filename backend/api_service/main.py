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
from routes import auth, users, profile, accounts, billing, services, asm, vs, settings_route, activity, assets, tasks, team, marketing
from models import marketing_models  # ensure marketing tables are registered

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Core API Service - All business logic and routes"
)

print(settings.CORS_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

@app.on_event("shutdown")
async def shutdown_event():
    """Close connections on shutdown"""
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
    return {"status": "healthy"}

# ==================== REGISTER ALL ROUTES ====================

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(profile.router)
app.include_router(accounts.router)
app.include_router(billing.router)
app.include_router(services.router)
app.include_router(asm.router)
app.include_router(vs.router)
app.include_router(vs.vs_router)
app.include_router(settings_route.router)
app.include_router(activity.router)
app.include_router(assets.router)
app.include_router(tasks.router)
app.include_router(team.router)
app.include_router(marketing.router)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

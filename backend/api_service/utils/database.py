"""
PostgreSQL Async Database Connection
"""

import logging
import os
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import declarative_base
from config.settings import settings

logger = logging.getLogger(__name__)

# -------------------------------------------------------------------
# Async Engine
# -------------------------------------------------------------------
engine = create_async_engine(
    settings.DATABASE_URL,  # must be async url
    pool_pre_ping=True,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
    pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "1800")),  # recycle conns < server/proxy idle timeout
    echo=settings.DEBUG,
)

# -------------------------------------------------------------------
# Async Session Factory
# -------------------------------------------------------------------
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)

# -------------------------------------------------------------------
# Base Model
# -------------------------------------------------------------------
Base = declarative_base()

# -------------------------------------------------------------------
# FastAPI Dependency
# -------------------------------------------------------------------
async def get_db():
    """
    Async database dependency for FastAPI
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

# -------------------------------------------------------------------
# Initialize Database
# -------------------------------------------------------------------
async def init_db():
    """
    Initialize database. In production, Alembic owns DDL — tables are created and
    evolved via migrations, NOT create_all() (which has no migration history and
    silently diverges from the tracked schema). create_all() is gated behind
    DB_AUTO_CREATE=true for local dev / ephemeral test DBs only.
    """
    if os.getenv("DB_AUTO_CREATE", "false").lower() in ("1", "true", "yes"):
        logger.warning("DB_AUTO_CREATE enabled: running create_all() — do NOT use in production; run `alembic upgrade head` instead")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialized (migrations own DDL; set DB_AUTO_CREATE=true to auto-create for dev)")

# -------------------------------------------------------------------
# Close Database
# -------------------------------------------------------------------
async def close_db():
    """
    Close database connections
    """
    await engine.dispose()
    logger.info("Database connections closed")

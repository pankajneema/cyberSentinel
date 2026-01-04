"""
PostgreSQL Async Database Connection
"""

import logging
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
    pool_size=10,
    max_overflow=20,
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
    Initialize database - create all tables
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialized")

# -------------------------------------------------------------------
# Close Database
# -------------------------------------------------------------------
async def close_db():
    """
    Close database connections
    """
    await engine.dispose()
    logger.info("Database connections closed")

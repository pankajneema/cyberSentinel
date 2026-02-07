"""
Async Redis Connection for Reporting Module
"""

import logging
import os
from redis.asyncio import Redis, ConnectionPool

logger = logging.getLogger(__name__)

# -------------------------------------------------------------------
# Global Redis objects
# -------------------------------------------------------------------
redis_pool: ConnectionPool | None = None
redis_client: Redis | None = None


# -------------------------------------------------------------------
# Get Redis Client (Async Singleton)
# -------------------------------------------------------------------
async def get_redis() -> Redis | None:
    """
    Get async Redis client (singleton) for reporting module
    """
    global redis_client, redis_pool

    if redis_client is None:
        try:
            # Get Redis URL from environment or use default
            redis_url = os.getenv("REPORTING_REDIS_URL", "redis://localhost:6379/1")
            
            redis_pool = ConnectionPool.from_url(
                redis_url,
                max_connections=50,
                decode_responses=True,
            )

            redis_client = Redis(connection_pool=redis_pool)

            # Test connection
            await redis_client.ping()
            logger.info("Reporting Redis connected successfully")

        except ImportError:
            logger.warning("redis not installed, Redis disabled for reporting")
            return None

        except Exception as e:
            logger.warning(f"Redis connection failed for reporting: {e} - Redis disabled")
            redis_client = None
            redis_pool = None
            return None

    return redis_client


# -------------------------------------------------------------------
# Close Redis Connection
# -------------------------------------------------------------------
async def close_redis() -> None:
    """
    Close Redis connection
    """
    global redis_client, redis_pool

    if redis_client is not None:
        await redis_client.close()
        redis_client = None
        redis_pool = None
        logger.info("Reporting Redis connection closed")

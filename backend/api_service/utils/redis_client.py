"""
Async Redis Connection
"""

import logging
from redis.asyncio import Redis, ConnectionPool
from config.settings import settings

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
    Get async Redis client (singleton)
    """
    global redis_client, redis_pool

    if redis_client is None:
        try:
            redis_pool = ConnectionPool.from_url(
                settings.REDIS_URL,
                max_connections=50,
                decode_responses=True,
            )

            redis_client = Redis(connection_pool=redis_pool)

            # Test connection
            await redis_client.ping()
            logger.info("Redis connected successfully")

        except ImportError:
            logger.warning("redis not installed, Redis disabled")
            return None

        except Exception as e:
            logger.warning(f"Redis connection failed: {e} - Redis disabled")
            redis_client = None
            redis_pool = None
            return None

    return redis_client


# -------------------------------------------------------------------
# Close Redis
# -------------------------------------------------------------------
async def close_redis():
    """
    Close Redis connections
    """
    global redis_client, redis_pool

    try:
        if redis_client:
            await redis_client.close()

        if redis_pool:
            await redis_pool.disconnect(inuse_connections=True)

    except Exception:
        pass
    finally:
        redis_client = None
        redis_pool = None
        logger.info("Redis connections closed")

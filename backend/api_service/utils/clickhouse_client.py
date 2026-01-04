"""
Async ClickHouse Connection
"""

import logging
from config.settings import settings
import clickhouse_connect

logger = logging.getLogger(__name__)

# -------------------------------------------------------------------
# Global client
# -------------------------------------------------------------------
clickhouse_client = None


# -------------------------------------------------------------------
# Get ClickHouse Client (Async Singleton)
# -------------------------------------------------------------------
async def get_clickhouse():
    """
    Get async ClickHouse client (singleton)
    """
    global clickhouse_client

    if clickhouse_client is None:
        try:
            clickhouse_client = await clickhouse_connect.get_async_client(
                host=settings.CLICKHOUSE_HOST,
                port=settings.CLICKHOUSE_PORT,
                database="cybersentinel",
                username=getattr(settings, "CLICKHOUSE_USER", "default"),
                password=getattr(settings, "CLICKHOUSE_PASSWORD", ""),
            )

            # Test connection
            await clickhouse_client.query("SELECT 1")
            logger.info("ClickHouse connected successfully")

        except ImportError:
            logger.warning(
                "clickhouse-connect not installed, ClickHouse disabled"
            )
            return None

        except Exception as e:
            logger.error(f"ClickHouse connection failed: {e}")
            clickhouse_client = None
            return None

    return clickhouse_client


# -------------------------------------------------------------------
# Close ClickHouse
# -------------------------------------------------------------------
async def close_clickhouse():
    """
    Close ClickHouse connection
    """
    global clickhouse_client

    try:
        if clickhouse_client:
            await clickhouse_client.close()
    except Exception:
        pass
    finally:
        clickhouse_client = None
        logger.info("ClickHouse connection closed")

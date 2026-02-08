"""
Database Migration Script
Run this to create all tables in the database
"""

import asyncio
import logging
from utils.database import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def migrate_database():
    """
    Create all database tables (async)
    """
    try:
        logger.info("Starting database migration...")
        await init_db()
        logger.info("✅ Database migration completed successfully!")
    except Exception as e:
        logger.error(f"❌ Migration failed: {str(e)}")
        raise


if __name__ == "__main__":
    asyncio.run(migrate_database())

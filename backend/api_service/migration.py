"""
Database Migration Script
Run this to create all tables in the database
"""

from utils.database import init_db, engine, Base
from models.auth_models import User, Company, Profile
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_database():
    """
    Create all database tables
    """
    try:
        logger.info("Starting database migration...")
        
        # Import all models to ensure they're registered with Base
        from models.auth_models import User, Company, Profile
        
        # Create all tables
        Base.metadata.create_all(bind=engine)
        
        logger.info("✅ Database migration completed successfully!")
        logger.info(f"Created tables: {', '.join(Base.metadata.tables.keys())}")
        
    except Exception as e:
        logger.error(f"❌ Migration failed: {str(e)}")
        raise

if __name__ == "__main__":
    migrate_database()
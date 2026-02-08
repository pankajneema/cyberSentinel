"""
PostgreSQL Async Database Repository with Retry Logic
"""

import logging
from typing import TypeVar, Generic, Type, Optional, List, Dict, Any
from sqlalchemy import select, update, delete, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)

logger = logging.getLogger(__name__)

# Generic type for SQLAlchemy models
ModelType = TypeVar("ModelType")


class DatabaseRepository(Generic[ModelType]):
    """
    Generic async repository with retry logic for database operations
    """

    def __init__(self, model: Type[ModelType]):
        self.model = model

    # -------------------------------------------------------------------
    # INSERT Operations
    # -------------------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def insert(
        self, 
        db: AsyncSession, 
        obj_data: Dict[str, Any],
        commit: bool = True
    ) -> ModelType:
        """
        Insert a single record with retry logic
        
        Args:
            db: Database session
            obj_data: Dictionary of data to insert
            commit: Whether to commit immediately
            
        Returns:
            Created model instance
        """
        try:
            db_obj = self.model(**obj_data)
            db.add(db_obj)
            
            if commit:
                await db.commit()
                await db.refresh(db_obj)
            else:
                await db.flush()
                
            logger.info(f"Inserted {self.model.__name__}: {obj_data}")
            return db_obj
            
        except IntegrityError as e:
            await db.rollback()
            logger.error(f"Integrity error inserting {self.model.__name__}: {e}")
            raise
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error inserting {self.model.__name__}: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def insert_many(
        self, 
        db: AsyncSession, 
        objects_data: List[Dict[str, Any]],
        commit: bool = True
    ) -> List[ModelType]:
        """
        Insert multiple records with retry logic
        
        Args:
            db: Database session
            objects_data: List of dictionaries to insert
            commit: Whether to commit immediately
            
        Returns:
            List of created model instances
        """
        try:
            db_objects = [self.model(**obj_data) for obj_data in objects_data]
            db.add_all(db_objects)
            
            if commit:
                await db.commit()
                for obj in db_objects:
                    await db.refresh(obj)
            else:
                await db.flush()
                
            logger.info(f"Inserted {len(db_objects)} {self.model.__name__} records")
            return db_objects
            
        except IntegrityError as e:
            await db.rollback()
            logger.error(f"Integrity error inserting multiple {self.model.__name__}: {e}")
            raise
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error inserting multiple {self.model.__name__}: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def bulk_insert(
        self, 
        db: AsyncSession, 
        objects_data: List[Dict[str, Any]]
    ) -> int:
        """
        Bulk insert using SQLAlchemy Core (faster for large datasets)
        
        Args:
            db: Database session
            objects_data: List of dictionaries to insert
            
        Returns:
            Number of rows inserted
        """
        try:
            stmt = insert(self.model).values(objects_data)
            result = await db.execute(stmt)
            await db.commit()
            
            count = result.rowcount
            logger.info(f"Bulk inserted {count} {self.model.__name__} records")
            return count
            
        except IntegrityError as e:
            await db.rollback()
            logger.error(f"Integrity error bulk inserting {self.model.__name__}: {e}")
            raise
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error bulk inserting {self.model.__name__}: {e}")
            raise

    # -------------------------------------------------------------------
    # FETCH Operations
    # -------------------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def fetch_by_id(
        self, 
        db: AsyncSession, 
        id: Any
    ) -> Optional[ModelType]:
        """
        Fetch a single record by ID with retry logic
        
        Args:
            db: Database session
            id: Primary key value
            
        Returns:
            Model instance or None
        """
        try:
            result = await db.get(self.model, id)
            return result
            
        except SQLAlchemyError as e:
            logger.error(f"Error fetching {self.model.__name__} by id {id}: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def fetch_one(
        self, 
        db: AsyncSession, 
        **filters
    ) -> Optional[ModelType]:
        """
        Fetch a single record by filters with retry logic
        
        Args:
            db: Database session
            **filters: Field=value pairs for filtering
            
        Returns:
            Model instance or None
        """
        try:
            stmt = select(self.model).filter_by(**filters)
            result = await db.execute(stmt)
            return result.scalar_one_or_none()
            
        except SQLAlchemyError as e:
            logger.error(f"Error fetching one {self.model.__name__}: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def fetch_all(
        self, 
        db: AsyncSession,
        skip: int = 0,
        limit: Optional[int] = None,
        **filters
    ) -> List[ModelType]:
        """
        Fetch all records matching filters with retry logic
        
        Args:
            db: Database session
            skip: Number of records to skip
            limit: Maximum number of records to return
            **filters: Field=value pairs for filtering
            
        Returns:
            List of model instances
        """
        try:
            stmt = select(self.model).filter_by(**filters)
            
            if skip:
                stmt = stmt.offset(skip)
            if limit:
                stmt = stmt.limit(limit)
                
            result = await db.execute(stmt)
            return list(result.scalars().all())
            
        except SQLAlchemyError as e:
            logger.error(f"Error fetching all {self.model.__name__}: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def fetch_by_ids(
        self, 
        db: AsyncSession, 
        ids: List[Any]
    ) -> List[ModelType]:
        """
        Fetch multiple records by IDs with retry logic
        
        Args:
            db: Database session
            ids: List of primary key values
            
        Returns:
            List of model instances
        """
        try:
            # Assuming primary key column is 'id'
            stmt = select(self.model).where(self.model.id.in_(ids))
            result = await db.execute(stmt)
            return list(result.scalars().all())
            
        except SQLAlchemyError as e:
            logger.error(f"Error fetching {self.model.__name__} by ids: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def count(
        self, 
        db: AsyncSession,
        **filters
    ) -> int:
        """
        Count records matching filters with retry logic
        
        Args:
            db: Database session
            **filters: Field=value pairs for filtering
            
        Returns:
            Count of matching records
        """
        try:
            from sqlalchemy import func
            stmt = select(func.count()).select_from(self.model).filter_by(**filters)
            result = await db.execute(stmt)
            return result.scalar()
            
        except SQLAlchemyError as e:
            logger.error(f"Error counting {self.model.__name__}: {e}")
            raise

    # -------------------------------------------------------------------
    # UPDATE Operations
    # -------------------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def update_by_id(
        self, 
        db: AsyncSession, 
        id: Any,
        update_data: Dict[str, Any],
        commit: bool = True
    ) -> Optional[ModelType]:
        """
        Update a single record by ID with retry logic
        
        Args:
            db: Database session
            id: Primary key value
            update_data: Dictionary of fields to update
            commit: Whether to commit immediately
            
        Returns:
            Updated model instance or None
        """
        try:
            db_obj = await db.get(self.model, id)
            if not db_obj:
                return None
                
            for key, value in update_data.items():
                setattr(db_obj, key, value)
                
            if commit:
                await db.commit()
                await db.refresh(db_obj)
            else:
                await db.flush()
                
            logger.info(f"Updated {self.model.__name__} id={id}")
            return db_obj
            
        except IntegrityError as e:
            await db.rollback()
            logger.error(f"Integrity error updating {self.model.__name__}: {e}")
            raise
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error updating {self.model.__name__}: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def update_many(
        self, 
        db: AsyncSession,
        update_data: Dict[str, Any],
        **filters
    ) -> int:
        """
        Update multiple records matching filters with retry logic
        
        Args:
            db: Database session
            update_data: Dictionary of fields to update
            **filters: Field=value pairs for filtering
            
        Returns:
            Number of rows updated
        """
        try:
            stmt = (
                update(self.model)
                .where(*[getattr(self.model, k) == v for k, v in filters.items()])
                .values(**update_data)
            )
            result = await db.execute(stmt)
            await db.commit()
            
            count = result.rowcount
            logger.info(f"Updated {count} {self.model.__name__} records")
            return count
            
        except IntegrityError as e:
            await db.rollback()
            logger.error(f"Integrity error updating multiple {self.model.__name__}: {e}")
            raise
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error updating multiple {self.model.__name__}: {e}")
            raise

    # -------------------------------------------------------------------
    # DELETE Operations
    # -------------------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def delete_by_id(
        self, 
        db: AsyncSession, 
        id: Any,
        commit: bool = True
    ) -> bool:
        """
        Delete a single record by ID with retry logic
        
        Args:
            db: Database session
            id: Primary key value
            commit: Whether to commit immediately
            
        Returns:
            True if deleted, False if not found
        """
        try:
            db_obj = await db.get(self.model, id)
            if not db_obj:
                return False
                
            await db.delete(db_obj)
            
            if commit:
                await db.commit()
            else:
                await db.flush()
                
            logger.info(f"Deleted {self.model.__name__} id={id}")
            return True
            
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error deleting {self.model.__name__}: {e}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def delete_many(
        self, 
        db: AsyncSession,
        **filters
    ) -> int:
        """
        Delete multiple records matching filters with retry logic
        
        Args:
            db: Database session
            **filters: Field=value pairs for filtering
            
        Returns:
            Number of rows deleted
        """
        try:
            stmt = delete(self.model).where(
                *[getattr(self.model, k) == v for k, v in filters.items()]
            )
            result = await db.execute(stmt)
            await db.commit()
            
            count = result.rowcount
            logger.info(f"Deleted {count} {self.model.__name__} records")
            return count
            
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error deleting multiple {self.model.__name__}: {e}")
            raise

    # -------------------------------------------------------------------
    # UPSERT Operation
    # -------------------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((SQLAlchemyError,)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def upsert(
        self, 
        db: AsyncSession,
        obj_data: Dict[str, Any],
        unique_fields: List[str],
        commit: bool = True
    ) -> ModelType:
        """
        Insert or update based on unique fields with retry logic
        
        Args:
            db: Database session
            obj_data: Dictionary of data
            unique_fields: List of field names that identify uniqueness
            commit: Whether to commit immediately
            
        Returns:
            Created or updated model instance
        """
        try:
            # Try to find existing record
            filters = {field: obj_data[field] for field in unique_fields}
            existing = await self.fetch_one(db, **filters)
            
            if existing:
                # Update existing
                for key, value in obj_data.items():
                    setattr(existing, key, value)
                db_obj = existing
            else:
                # Insert new
                db_obj = self.model(**obj_data)
                db.add(db_obj)
                
            if commit:
                await db.commit()
                await db.refresh(db_obj)
            else:
                await db.flush()
                
            logger.info(f"Upserted {self.model.__name__}")
            return db_obj
            
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Error upserting {self.model.__name__}: {e}")
            raise
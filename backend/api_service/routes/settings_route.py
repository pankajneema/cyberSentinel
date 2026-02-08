from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime

router = APIRouter(prefix="/api/v1/settings", tags=["Settings"])

from utils.auth_utils import get_current_user
from utils.database import get_db
from models.auth_models import UserSettings

@router.get("")
async def get_settings(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user["user_id"])
    )
    settings = result.scalar_one_or_none()

    if not settings:
        return {
            "notifications": {
                "email": True,
                "slack": False,
                "push": True
            },
            "preferences": {
                "theme": "light",
                "language": "en",
                "timezone": "UTC"
            }
        }

    return {
        "notifications": settings.notifications or {},
        "preferences": settings.preferences or {},
    }

@router.put("")
async def update_settings(
    settings: dict,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == current_user["user_id"])
    )
    existing = result.scalar_one_or_none()

    if not existing:
        existing = UserSettings(
            user_id=current_user["user_id"],
            notifications=settings.get("notifications", {}),
            preferences=settings.get("preferences", {}),
            created_at=datetime.utcnow(),
        )
        db.add(existing)
    else:
        existing.notifications = settings.get("notifications", existing.notifications)
        existing.preferences = settings.get("preferences", existing.preferences)
        existing.updated_at = datetime.utcnow()

    await db.commit()

    return {
        "notifications": existing.notifications or {},
        "preferences": existing.preferences or {},
    }

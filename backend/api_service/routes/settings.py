from fastapi import APIRouter, Depends

router = APIRouter(prefix="/api/v1/settings", tags=["Settings"])

from utils.auth_utils import get_current_user

@router.get("")
async def get_settings(current_user: dict = Depends(get_current_user)):
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

@router.put("")
async def update_settings(settings: dict, current_user: dict = Depends(get_current_user)):
    return {"message": "Settings updated", "settings": settings}


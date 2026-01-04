from fastapi import APIRouter, Depends
from datetime import datetime

router = APIRouter(prefix="/api/v1", tags=["Activity"])

from utils.auth_utils import get_current_user

@router.get("/activity")
async def get_activity(skip: int = 0, limit: int = 50, current_user: dict = Depends(get_current_user)):
    return {
        "activities": [{
            "id": "1",
            "type": "login",
            "description": "User logged in",
            "timestamp": datetime.utcnow().isoformat()
        }],
        "total": 1
    }

@router.get("/audit-logs")
async def get_audit_logs(skip: int = 0, limit: int = 100, current_user: dict = Depends(get_current_user)):
    return {"logs": [], "total": 0}


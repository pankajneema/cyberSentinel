"""
Activity / audit-log routes — real, org-scoped (Phase 3).

Backed by the real `audit_logs` table (models.tenancy_models.AuditLog), which is
written by routes/orgs.py::_audit on member/invite/role changes. No mock data.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from utils.database import get_db
from utils.auth import CurrentUser, get_current_user
from utils.tenancy import require_org
from models.tenancy_models import AuditLog, MemberProfile

router = APIRouter(prefix="/api/v1", tags=["Activity"])


def _resource_type(action: str) -> str:
    """Derive a resource type from an action like 'member.invited' -> 'member'."""
    return (action or "").split(".")[0] or "event"


async def _name_map(db: AsyncSession, org_id: str, actor_ids: set[str]) -> dict[str, str]:
    """Map actor user ids -> a human name (full_name or email). Single query."""
    actor_ids = {a for a in actor_ids if a}
    if not actor_ids:
        return {}
    rows = (
        await db.execute(
            select(
                MemberProfile.user_id,
                MemberProfile.full_name,
                MemberProfile.email,
            ).where(
                MemberProfile.org_id == org_id,
                MemberProfile.user_id.in_(actor_ids),
            )
        )
    ).all()
    return {r[0]: (r[1] or r[2] or r[0]) for r in rows}


async def _recent_logs(db: AsyncSession, org_id: str, skip: int, limit: int):
    query = (
        select(AuditLog)
        .where(AuditLog.org_id == org_id)
        .order_by(AuditLog.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    logs = (await db.execute(query)).scalars().all()
    names = await _name_map(db, org_id, {l.actor_user_id for l in logs})
    return logs, names


@router.get("/activity")
async def get_activity(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    logs, names = await _recent_logs(db, org_id, skip, limit)
    return [
        {
            "id": l.id,
            "user_id": l.actor_user_id,
            "user_name": names.get(l.actor_user_id, l.actor_user_id),
            "action": l.action,
            "resource_type": _resource_type(l.action),
            "resource_id": l.target,
            "details": l.meta or {},
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


@router.get("/audit-logs")
async def get_audit_logs(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    logs, names = await _recent_logs(db, org_id, skip, limit)
    return [
        {
            "id": l.id,
            "user_id": l.actor_user_id,
            "user_name": names.get(l.actor_user_id, l.actor_user_id),
            "action": l.action,
            "resource_type": _resource_type(l.action),
            "resource_id": l.target,
            "changes": l.meta or {},
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]

"""
Notifications — real, org-scoped + recipient-scoped (identity).

Producers for dedicated Notification rows can be added later; until then the
feed is seeded read-only from the org's real `audit_logs` so it never shows
fabricated content. Preferences persist per user.

Tenancy pattern mirrors routes/assets.py: CurrentUser + require_org, every query
filtered by org_id AND user_id (the recipient's user id).
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update

from utils.database import get_db
from utils.auth import CurrentUser, get_current_user
from utils.tenancy import require_org
from utils.ownership import get_owned_or_404
from models.notification_models import Notification, NotificationPreference
from models.tenancy_models import AuditLog

from schemas.notification_schema import (
    NotificationResponse,
    UnreadCountResponse,
    NotificationPreferenceResponse,
    NotificationPreferenceUpdate,
)

router = APIRouter(prefix="/api/v1/notifications", tags=["Notifications"])

# How many audit-derived items to surface when the user has no real rows yet.
_SEED_LIMIT = 20


def _audit_title(action: str) -> str:
    return (action or "event").replace(".", " ").replace("_", " ").title()


def _audit_body(target: Optional[str], meta: dict) -> Optional[str]:
    parts = []
    if target:
        parts.append(str(target))
    if isinstance(meta, dict) and meta.get("role"):
        parts.append(f"role: {meta['role']}")
    return " — ".join(parts) if parts else None


async def _seed_items(db: AsyncSession, org_id: str) -> list[dict]:
    """Read-only notification items derived from the org's recent audit trail."""
    logs = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.org_id == org_id)
            .order_by(AuditLog.created_at.desc())
            .limit(_SEED_LIMIT)
        )
    ).scalars().all()
    return [
        {
            "id": f"audit:{log.id}",
            "title": _audit_title(log.action),
            "body": _audit_body(log.target, log.meta or {}),
            "type": (log.action or "").split(".")[0] or "event",
            "link": None,
            "is_read": False,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]


async def _has_rows(db: AsyncSession, org_id: str, user_id: str) -> bool:
    count = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.org_id == org_id, Notification.user_id == user_id)
        )
    ).scalar() or 0
    return count > 0


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    unread_only: bool = False,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)

    if not await _has_rows(db, org_id, user.user_id):
        # No real notification rows yet — surface real audit events (all unread).
        return await _seed_items(db, org_id)

    query = select(Notification).where(
        Notification.org_id == org_id,
        Notification.user_id == user.user_id,
    )
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    query = query.order_by(Notification.created_at.desc())
    rows = (await db.execute(query)).scalars().all()
    return [r.to_dict() for r in rows]


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)

    if not await _has_rows(db, org_id, user.user_id):
        # Seeded items are all unread; keep the badge consistent with the feed.
        return UnreadCountResponse(count=len(await _seed_items(db, org_id)))

    count = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.org_id == org_id,
                Notification.user_id == user.user_id,
                Notification.is_read.is_(False),
            )
        )
    ).scalar() or 0
    return UnreadCountResponse(count=count)


async def _owned(db: AsyncSession, notif_id: str, org_id: str, user_id: str) -> Notification:
    return await get_owned_or_404(
        db, Notification, notif_id, org_id, detail="Notification not found",
        extra_criteria=(Notification.user_id == user_id,),
    )


@router.post("/{notif_id}/read", response_model=NotificationResponse)
async def mark_read(
    notif_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    row = await _owned(db, notif_id, org_id, user.user_id)
    row.is_read = True
    await db.commit()
    await db.refresh(row)
    return row.to_dict()


@router.post("/{notif_id}/unread", response_model=NotificationResponse)
async def mark_unread(
    notif_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    row = await _owned(db, notif_id, org_id, user.user_id)
    row.is_read = False
    await db.commit()
    await db.refresh(row)
    return row.to_dict()


@router.post("/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    await db.execute(
        update(Notification)
        .where(
            Notification.org_id == org_id,
            Notification.user_id == user.user_id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    await db.commit()
    return {"message": "All notifications marked as read"}


async def _get_or_create_pref(
    db: AsyncSession, org_id: str, user_id: str
) -> NotificationPreference:
    pref = (
        await db.execute(
            select(NotificationPreference).where(
                NotificationPreference.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if pref is None:
        pref = NotificationPreference(org_id=org_id, user_id=user_id)
        db.add(pref)
        await db.commit()
        await db.refresh(pref)
    return pref


@router.get("/preferences", response_model=NotificationPreferenceResponse)
async def get_preferences(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    pref = await _get_or_create_pref(db, org_id, user.user_id)
    return NotificationPreferenceResponse(email=pref.email, push=pref.push, in_app=pref.in_app)


@router.put("/preferences", response_model=NotificationPreferenceResponse)
async def update_preferences(
    payload: NotificationPreferenceUpdate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    pref = await _get_or_create_pref(db, org_id, user.user_id)
    data = payload.dict(exclude_unset=True)
    for key, value in data.items():
        setattr(pref, key, value)
    await db.commit()
    await db.refresh(pref)
    return NotificationPreferenceResponse(email=pref.email, push=pref.push, in_app=pref.in_app)

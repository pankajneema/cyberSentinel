"""
Organizations & memberships (Phase 2).

The tenant-correct team model:
  - members are `member_profiles` rows scoped by `org_id`
  - invites are single-use, expiring `org_invites`
  - all mutations are RBAC-enforced (owner/admin) and audit-logged

This supersedes the legacy `team.py` flow built on the old `companies`/`users`
tables. Endpoints authenticate via the verified identity (utils/auth.py).
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from utils.database import get_db
from utils.auth import CurrentUser, get_current_user, require_role
from models.tenancy_models import (
    Organization,
    MemberProfile,
    OrgInvite,
    AuditLog,
)

router = APIRouter(prefix="/api/v1/orgs", tags=["organizations"])

INVITE_TTL_HOURS = 72
ASSIGNABLE_ROLES = {"admin", "analyst", "reader"}


# ----------------------------- schemas -----------------------------
class MemberOut(BaseModel):
    id: str
    user_id: str
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool


class InviteCreate(BaseModel):
    email: EmailStr
    role: str = Field(default="reader")


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    expires_at: datetime
    created_at: datetime


class AcceptInvite(BaseModel):
    token: str


class RoleUpdate(BaseModel):
    role: str


# ----------------------------- helpers -----------------------------
async def _audit(db, *, org_id, actor, action, target, meta=None):
    db.add(AuditLog(org_id=org_id, actor_user_id=actor, action=action, target=target, meta=meta or {}))


# ----------------------------- members -----------------------------
@router.get("/me/members", response_model=list[MemberOut])
async def list_members(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(MemberProfile).where(
                MemberProfile.org_id == user.org_id,
                MemberProfile.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return [
        MemberOut(
            id=m.id, user_id=m.user_id, email=m.email,
            full_name=m.full_name, role=m.role, is_active=m.is_active,
        )
        for m in rows
    ]


@router.patch("/members/{member_id}/role", response_model=MemberOut)
async def change_role(
    member_id: str,
    payload: RoleUpdate,
    user: CurrentUser = Depends(require_role("owner", "admin")),
    db: AsyncSession = Depends(get_db),
):
    if payload.role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    member = (
        await db.execute(select(MemberProfile).where(MemberProfile.id == member_id))
    ).scalar_one_or_none()
    # Tenant isolation: can only touch members of your own org.
    if member is None or member.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(status_code=403, detail="Cannot change the owner's role")
    member.role = payload.role
    await _audit(db, org_id=user.org_id, actor=user.user_id, action="member.role_changed",
                 target=member.email, meta={"role": payload.role})
    await db.commit()
    await db.refresh(member)
    return MemberOut(id=member.id, user_id=member.user_id, email=member.email,
                     full_name=member.full_name, role=member.role, is_active=member.is_active)


@router.delete("/members/{member_id}")
async def remove_member(
    member_id: str,
    user: CurrentUser = Depends(require_role("owner", "admin")),
    db: AsyncSession = Depends(get_db),
):
    member = (
        await db.execute(select(MemberProfile).where(MemberProfile.id == member_id))
    ).scalar_one_or_none()
    if member is None or member.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(status_code=403, detail="Cannot remove the owner")
    # Soft delete (audit C-3 / M-3): reversible, traceable.
    member.is_active = False
    member.deleted_at = datetime.utcnow()
    await _audit(db, org_id=user.org_id, actor=user.user_id, action="member.removed", target=member.email)
    await db.commit()
    return {"ok": True}


# ----------------------------- invites -----------------------------
@router.get("/invites", response_model=list[InviteOut])
async def list_invites(
    user: CurrentUser = Depends(require_role("owner", "admin")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(OrgInvite).where(
                OrgInvite.org_id == user.org_id,
                OrgInvite.status == "pending",
            )
        )
    ).scalars().all()
    return [InviteOut(id=i.id, email=i.email, role=i.role, status=i.status,
                      expires_at=i.expires_at, created_at=i.created_at) for i in rows]


@router.post("/invites", response_model=InviteOut, status_code=201)
async def create_invite(
    payload: InviteCreate,
    user: CurrentUser = Depends(require_role("owner", "admin")),
    db: AsyncSession = Depends(get_db),
):
    if payload.role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    invite = OrgInvite(
        org_id=user.org_id,
        email=payload.email.lower(),
        role=payload.role,
        token=secrets.token_urlsafe(32),
        invited_by=user.user_id,
        expires_at=datetime.utcnow() + timedelta(hours=INVITE_TTL_HOURS),
    )
    db.add(invite)
    await _audit(db, org_id=user.org_id, actor=user.user_id, action="member.invited",
                 target=payload.email, meta={"role": payload.role})
    await db.commit()
    await db.refresh(invite)

    # Best-effort email (no-op if SMTP not configured).
    try:
        from notificationservice.email import send_group_invite_notification
        org = (await db.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
        send_group_invite_notification(
            {
                "sender": user.email,
                "team_name": org.name if org else "the team",
                "role": payload.role,
                "invite_link": f"/invite/{invite.token}",
            },
            to_email=invite.email,
        )
    except Exception:
        pass

    return InviteOut(id=invite.id, email=invite.email, role=invite.role, status=invite.status,
                     expires_at=invite.expires_at, created_at=invite.created_at)


@router.delete("/invites/{invite_id}")
async def revoke_invite(
    invite_id: str,
    user: CurrentUser = Depends(require_role("owner", "admin")),
    db: AsyncSession = Depends(get_db),
):
    invite = (await db.execute(select(OrgInvite).where(OrgInvite.id == invite_id))).scalar_one_or_none()
    if invite is None or invite.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = "revoked"
    invite.responded_at = datetime.utcnow()
    await _audit(db, org_id=user.org_id, actor=user.user_id, action="invite.revoked", target=invite.email)
    await db.commit()
    return {"ok": True}


@router.post("/invites/accept", response_model=MemberOut)
async def accept_invite(
    payload: AcceptInvite,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Finalize the org-join that Invite.tsx defers. The authenticated user's email
    must match the invited email; the invite must be pending and unexpired.
    """
    invite = (
        await db.execute(select(OrgInvite).where(OrgInvite.token == payload.token))
    ).scalar_one_or_none()
    if invite is None or invite.status != "pending":
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    if invite.expires_at < datetime.utcnow():
        invite.status = "revoked"
        await db.commit()
        raise HTTPException(status_code=410, detail="Invite expired")
    if invite.email.lower() != user.email.lower():
        raise HTTPException(status_code=403, detail="Invite was issued to a different email")

    # Attach this user to the inviting org with the invited role. A user may have
    # a self-provisioned org from first login; we move their active profile into
    # the inviting org (single-org membership for now; multi-org is a later step).
    member = (
        await db.execute(
            select(MemberProfile).where(
                MemberProfile.user_id == user.user_id,
                MemberProfile.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()

    if member is None:
        member = MemberProfile(
            org_id=invite.org_id,
            user_id=user.user_id,
            email=user.email,
            full_name=user.email,
            role=invite.role,
        )
        db.add(member)
    else:
        member.org_id = invite.org_id
        member.role = invite.role

    invite.status = "accepted"
    invite.responded_at = datetime.utcnow()
    await _audit(db, org_id=invite.org_id, actor=user.user_id, action="invite.accepted", target=user.email)
    await db.commit()
    await db.refresh(member)

    return MemberOut(id=member.id, user_id=member.user_id, email=member.email,
                     full_name=member.full_name, role=member.role, is_active=member.is_active)

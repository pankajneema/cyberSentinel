"""
Team Management Routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime
import os
import uuid

from utils.database import get_db
from utils.auth_utils import get_current_user
from utils.auth_utils import hash_password, create_access_token
from models.auth_models import User, Profile, Company, TeamInvite, TeamRole
from utils.emailer import send_group_invite_notification, send_member_removed_notification

router = APIRouter(prefix="/api/v1/team", tags=["Team"])


class InviteRequest(BaseModel):
    email: EmailStr
    role: str = "reader"


class InviteResponse(BaseModel):
    id: str
    email: EmailStr
    role: str
    status: str
    token: str
    created_at: Optional[str]


class TeamMemberResponse(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    status: str
    is_superadmin: bool
    avatar_url: Optional[str] = None


class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None


class RoleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]

class InviteAcceptRequest(BaseModel):
    full_name: str = Field(min_length=1)
    password: str = Field(min_length=6)


def _invite_dict(invite: TeamInvite):
    return {
        "id": invite.id,
        "email": invite.email,
        "role": invite.role,
        "status": invite.status,
        "token": invite.token,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
    }


@router.get("/members", response_model=List[TeamMemberResponse])
async def list_members(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user or not user.company_id:
        raise HTTPException(status_code=404, detail="Company not found")

    members_res = await db.execute(select(User).where(User.company_id == user.company_id))
    members = members_res.scalars().all()
    member_ids = [m.id for m in members]
    profiles_res = await db.execute(select(Profile).where(Profile.user_id.in_(member_ids)))
    profiles = profiles_res.scalars().all()
    profile_map = {p.user_id: p for p in profiles}
    company_res = await db.execute(select(Company).where(Company.id == user.company_id))
    company = company_res.scalar_one_or_none()
    owner_id = company.owner_user_id if company else None
    return [
        TeamMemberResponse(
            id=m.id,
            name=m.name,
            email=m.email,
            role=m.role,
            status="active" if m.is_active else "inactive",
            is_superadmin=bool(owner_id and owner_id == m.id),
            avatar_url=profile_map.get(m.id).avatar_url if profile_map.get(m.id) else None,
        )
        for m in members
    ]


@router.delete("/members/{member_id}")
async def remove_member(
    member_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user or not user.company_id:
        raise HTTPException(status_code=404, detail="Company not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can remove members")
    if member_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")

    member_res = await db.execute(select(User).where(User.id == member_id, User.company_id == user.company_id))
    member = member_res.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Prepare notification before delete
    company_res = await db.execute(select(Company).where(Company.id == user.company_id))
    company = company_res.scalar_one_or_none()
    if company and company.owner_user_id == member.id:
        raise HTTPException(status_code=403, detail="Cannot remove the superadmin")

    await db.delete(member)
    await db.commit()

    try:
        await send_member_removed_notification(
            {
                "removed_name": member.name,
                "removed_by": user.name,
            },
            to_email=member.email,
        )
    except Exception as e:
        print(f"[EMAIL ERROR] Remove member notification failed: {e}")
    return {"message": "Member removed"}


@router.get("/invites", response_model=List[InviteResponse])
async def list_invites(
    status_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user or not user.company_id:
        raise HTTPException(status_code=404, detail="Company not found")

    query = select(TeamInvite).where(TeamInvite.company_id == user.company_id)
    if status_filter:
        query = query.where(TeamInvite.status == status_filter)

    invites_res = await db.execute(query.order_by(TeamInvite.created_at.desc()))
    invites = invites_res.scalars().all()
    return [InviteResponse(**_invite_dict(i)) for i in invites]


@router.post("/invites", response_model=InviteResponse)
async def create_invite(
    payload: InviteRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user or not user.company_id:
        raise HTTPException(status_code=404, detail="Company not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can invite members")

    # prevent duplicate pending invites
    existing_res = await db.execute(
        select(TeamInvite).where(
            TeamInvite.company_id == user.company_id,
            TeamInvite.email == payload.email,
            TeamInvite.status == "pending",
        )
    )
    existing = existing_res.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Invite already pending for this email")

    token = str(uuid.uuid4())
    invite = TeamInvite(
        id=str(uuid.uuid4()),
        company_id=user.company_id,
        email=payload.email,
        role=payload.role,
        status="pending",
        token=token,
        invited_by=user.id,
        created_at=datetime.utcnow(),
    )
    db.add(invite)
    await db.commit()

    # send email
    frontend_base = os.getenv("FRONTEND_URL")
    invite_url = f"{frontend_base.rstrip('/')}/invite/{token}"

    send_group_invite_notification(
        {
            "sender": user.name,
            "invitee_name": payload.email.split("@")[0],
            "role": payload.role,
            "invite_link": invite_url,
        },
        to_email=payload.email,
    )

    return InviteResponse(**_invite_dict(invite))


@router.post("/invites/{token}/accept")
async def accept_invite(
    token: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    invite_res = await db.execute(select(TeamInvite).where(TeamInvite.token == token))
    invite = invite_res.scalar_one_or_none()
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=404, detail="Invite not found or already processed")

    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.email.lower() != invite.email.lower():
        raise HTTPException(status_code=403, detail="This invite is not for your email")

    user.company_id = invite.company_id
    user.role = invite.role
    user.is_active = True
    user.updated_at = datetime.utcnow()

    invite.status = "accepted"
    invite.responded_at = datetime.utcnow()

    await db.commit()
    return {"message": "Invite accepted"}


@router.post("/invites/{token}/accept-public")
async def accept_invite_public(
    token: str,
    payload: InviteAcceptRequest,
    db: AsyncSession = Depends(get_db),
):
    invite_res = await db.execute(select(TeamInvite).where(TeamInvite.token == token))
    invite = invite_res.scalar_one_or_none()
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=404, detail="Invite not found or already processed")

    company_res = await db.execute(select(Company).where(Company.id == invite.company_id))
    company = company_res.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found for this invite")

    user_res = await db.execute(select(User).where(User.email == invite.email))
    user = user_res.scalar_one_or_none()
    if user:
        raise HTTPException(
            status_code=409,
            detail="Account already exists. Please login to accept the invite.",
        )

    user = User(
        id=str(uuid.uuid4()),
        email=invite.email,
        name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=invite.role,
        company_id=invite.company_id,
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(user)
    await db.flush()

    profile = Profile(
        id=str(uuid.uuid4()),
        user_id=user.id,
        full_name=payload.full_name,
        email=invite.email,
        role=invite.role,
    )
    db.add(profile)

    invite.status = "accepted"
    invite.responded_at = datetime.utcnow()

    await db.commit()

    access_token = await create_access_token({"sub": user.email, "user_id": user.id})
    return {
        "message": "Invite accepted",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.name,
            "role": user.role,
        },
    }


@router.post("/invites/{token}/decline")
async def decline_invite(
    token: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    invite_res = await db.execute(select(TeamInvite).where(TeamInvite.token == token))
    invite = invite_res.scalar_one_or_none()
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=404, detail="Invite not found or already processed")

    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.email.lower() != invite.email.lower():
        raise HTTPException(status_code=403, detail="This invite is not for your email")

    invite.status = "declined"
    invite.responded_at = datetime.utcnow()

    await db.commit()
    return {"message": "Invite declined"}


@router.get("/roles", response_model=List[RoleResponse])
async def list_roles(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user or not user.company_id:
        raise HTTPException(status_code=404, detail="Company not found")

    roles_res = await db.execute(select(TeamRole).where(TeamRole.company_id == user.company_id))
    roles = roles_res.scalars().all()
    return [RoleResponse(id=r.id, name=r.name, description=r.description) for r in roles]


@router.post("/roles", response_model=RoleResponse)
async def create_role(
    payload: RoleCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user or not user.company_id:
        raise HTTPException(status_code=404, detail="Company not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create roles")

    role = TeamRole(
        id=str(uuid.uuid4()),
        company_id=user.company_id,
        name=payload.name,
        description=payload.description,
        created_at=datetime.utcnow(),
    )
    db.add(role)
    await db.commit()
    return RoleResponse(id=role.id, name=role.name, description=role.description)


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_res = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_res.scalar_one_or_none()
    if not user or not user.company_id:
        raise HTTPException(status_code=404, detail="Company not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete roles")

    role_res = await db.execute(select(TeamRole).where(TeamRole.id == role_id, TeamRole.company_id == user.company_id))
    role = role_res.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    await db.delete(role)
    await db.commit()
    return {"message": "Role deleted"}

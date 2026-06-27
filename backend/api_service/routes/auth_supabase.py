"""
Slim auth router for the Supabase-auth era.

Everything credential-related (signup, login, password reset, magic link,
email verification, OAuth, MFA, refresh, logout) now happens in Supabase via
the frontend SDK. The backend no longer owns any of that.

What remains here is the *app-side* of identity:
  - GET   /auth/me        -> verified identity + synced profile/org/role
  - PATCH /auth/profile   -> update editable profile fields
  - GET   /auth/settings  -> notification/UI preferences
  - PUT   /auth/settings  -> update preferences

The old stub endpoints (refresh / forgot-password / reset-password /
magic-link / fake logout) are intentionally removed.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from utils.database import get_db
from utils.supabase_auth import CurrentUser, get_current_user
from models.tenancy_models import MemberProfile, MemberSettings, Organization

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# ----------------------------- schemas -----------------------------
class MeResponse(BaseModel):
    user_id: str
    email: str
    role: str
    org_id: Optional[str]
    org_name: Optional[str] = None
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=120)
    avatar_url: Optional[str] = None
    country: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=40)


class SettingsPayload(BaseModel):
    notifications: dict = {}
    preferences: dict = {}


# ----------------------------- routes ------------------------------
@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return the verified identity plus synced profile/org details."""
    profile = (
        await db.execute(
            select(MemberProfile).where(MemberProfile.supabase_user_id == user.user_id)
        )
    ).scalar_one_or_none()
    org = None
    if user.org_id:
        org = (
            await db.execute(select(Organization).where(Organization.id == user.org_id))
        ).scalar_one_or_none()
    return MeResponse(
        user_id=user.user_id,
        email=user.email,
        role=user.role,
        org_id=user.org_id,
        org_name=org.name if org else None,
        full_name=profile.full_name if profile else None,
        avatar_url=profile.avatar_url if profile else None,
        phone=profile.phone if profile else None,
        country=profile.country if profile else None,
    )


@router.patch("/profile", response_model=MeResponse)
async def update_profile(
    payload: ProfileUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = (
        await db.execute(
            select(MemberProfile).where(MemberProfile.supabase_user_id == user.user_id)
        )
    ).scalar_one_or_none()
    if profile is None:
        # get_current_user always provisions one, but guard anyway.
        from utils.identity_sync import sync_profile_and_org

        profile = await sync_profile_and_org(
            db,
            supabase_user_id=user.user_id,
            email=user.email,
            full_name=payload.full_name or user.email,
            role=user.role,
        )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    await db.commit()
    await db.refresh(profile)

    return await me(user=user, db=db)


@router.get("/settings", response_model=SettingsPayload)
async def get_settings(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(
            select(MemberSettings).where(
                MemberSettings.org_id == user.org_id,
                MemberSettings.supabase_user_id == user.user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return SettingsPayload()
    return SettingsPayload(notifications=row.notifications, preferences=row.preferences)


@router.put("/settings", response_model=SettingsPayload)
async def put_settings(
    payload: SettingsPayload,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(MemberSettings).where(
                MemberSettings.org_id == user.org_id,
                MemberSettings.supabase_user_id == user.user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = MemberSettings(
            org_id=user.org_id,
            supabase_user_id=user.user_id,
            notifications=payload.notifications,
            preferences=payload.preferences,
        )
        db.add(row)
    else:
        row.notifications = payload.notifications
        row.preferences = payload.preferences
    await db.commit()
    return payload

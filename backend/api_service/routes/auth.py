"""
Auth router — we are the identity provider now (see utils/auth.py).

Endpoints:
  - POST  /auth/signup          -> create account, mint tokens
  - POST  /auth/login            -> verify credentials, mint tokens
  - POST  /auth/refresh          -> rotate a refresh token for a new pair
  - POST  /auth/logout           -> revoke one session or all of them
  - POST  /auth/forgot-password  -> issue a reset token (dev-only: logged, not emailed)
  - POST  /auth/reset-password   -> consume a reset token, set a new password
  - PATCH /auth/password         -> authenticated password change
  - GET   /auth/me               -> verified identity + synced profile/org
  - PATCH /auth/profile          -> update editable profile fields
  - GET/PUT /auth/settings       -> notification/UI preferences

No email delivery exists in this codebase — forgot-password logs the reset
link to the server console (clearly marked [DEV-ONLY]) instead of sending it.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from utils.database import get_db
from utils.auth import (
    CurrentUser,
    get_current_user,
    hash_password,
    verify_password,
    create_access_token,
    generate_opaque_token,
    hash_token,
)
from utils.identity_sync import sync_profile_and_org
from models.user_models import User, RefreshToken, PasswordResetToken
from models.tenancy_models import MemberProfile, MemberSettings, Organization

logger = logging.getLogger("cybersentinel.auth")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

REFRESH_TOKEN_EXPIRE = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
RESET_TOKEN_EXPIRE = timedelta(minutes=60)
_GENERIC_LOGIN_ERROR = "Invalid email or password"


# ----------------------------- schemas -----------------------------
def _validate_password_strength(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not re.search(r"[a-z]", v):
        raise ValueError("Password must contain a lowercase letter")
    if not re.search(r"[A-Z]", v):
        raise ValueError("Password must contain an uppercase letter")
    if not re.search(r"\d", v):
        raise ValueError("Password must contain a number")
    return v


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = Field(min_length=1, max_length=120)
    company_name: Optional[str] = Field(default=None, max_length=120)

    _validate = field_validator("password")(_validate_password_strength)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    role: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None
    all: bool = False


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    _validate = field_validator("new_password")(_validate_password_strength)


class ChangePasswordRequest(BaseModel):
    current_password: Optional[str] = None
    new_password: str

    _validate = field_validator("new_password")(_validate_password_strength)


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


# ----------------------------- helpers ------------------------------
async def _mint_tokens(
    db: AsyncSession, user: User, *, org_name_hint: Optional[str] = None,
) -> TokenResponse:
    """Sync the org/profile bootstrap, then issue an access+refresh pair."""
    profile = await sync_profile_and_org(
        db, user_id=user.id, email=user.email, full_name=user.full_name or user.email,
        org_name_hint=org_name_hint,
    )
    access_token = create_access_token(
        user_id=user.id, email=user.email, role=profile.role, org_id=profile.org_id,
    )
    raw_refresh = generate_opaque_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        expires_at=datetime.utcnow() + REFRESH_TOKEN_EXPIRE,
    ))
    await db.commit()
    return TokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        user=UserOut(id=user.id, email=user.email, full_name=user.full_name, role=profile.role),
    )


# ----------------------------- credential routes ------------------------------
@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        last_login_at=datetime.utcnow(),
    )
    db.add(user)
    await db.flush()  # get user.id

    # sync_profile_and_org always makes a brand-new user the owner of their own
    # org — role is never taken from client input.
    return await _mint_tokens(db, user, org_name_hint=payload.company_name)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if user is None or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail=_GENERIC_LOGIN_ERROR)

    user.last_login_at = datetime.utcnow()
    return await _mint_tokens(db, user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_token(payload.refresh_token)
    row = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    ).scalar_one_or_none()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if row.revoked_at is not None:
        # Reuse of an already-revoked token is a theft signal: kill every
        # session for this user, not just this one.
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.utcnow())
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token already used")

    if row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user = (await db.execute(select(User).where(User.id == row.user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="Account no longer exists")

    row.revoked_at = datetime.utcnow()  # rotation: this token is now spent
    return await _mint_tokens(db, user)


@router.post("/logout")
async def logout(
    payload: LogoutRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    if payload.all:
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == current_user.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
    elif payload.refresh_token:
        await db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == current_user.user_id,
                RefreshToken.token_hash == hash_token(payload.refresh_token),
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
    await db.commit()
    return {"message": "Logged out"}


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    # Always 200 with a generic message — never reveal whether the account exists.
    user = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    if user is not None:
        raw_token = generate_opaque_token()
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw_token),
            expires_at=datetime.utcnow() + RESET_TOKEN_EXPIRE,
        ))
        await db.commit()
        reset_link = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"
        # No email service exists in this codebase — logging is the dev-only
        # stopgap until real mail delivery is built (separate, larger scope).
        logger.warning("[DEV-ONLY] Password reset link for %s: %s", payload.email, reset_link)
    return {"message": "If an account exists for that email, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_token(payload.token)
    row = (
        await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None or row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    user = (await db.execute(select(User).where(User.id == row.user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    user.password_hash = hash_password(payload.new_password)
    row.used_at = datetime.utcnow()
    # A password reset should kill every existing session.
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.utcnow())
    )
    await db.commit()
    return {"message": "Password reset successful"}


@router.patch("/password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = (await db.execute(select(User).where(User.id == current_user.user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")

    if user.password_hash is not None:
        # Normal case: must prove the current password.
        if not payload.current_password or not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    # else: OAuth-only account setting a password for the first time — nothing to verify.

    user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"message": "Password updated"}


# ----------------------------- profile / settings ------------------------------
@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return the verified identity plus synced profile/org details."""
    profile = (
        await db.execute(select(MemberProfile).where(MemberProfile.user_id == user.user_id))
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
        await db.execute(select(MemberProfile).where(MemberProfile.user_id == user.user_id))
    ).scalar_one_or_none()
    if profile is None:
        # get_current_user always provisions one, but guard anyway.
        profile = await sync_profile_and_org(
            db, user_id=user.user_id, email=user.email, full_name=payload.full_name or user.email,
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
                MemberSettings.user_id == user.user_id,
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
                MemberSettings.user_id == user.user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = MemberSettings(
            org_id=user.org_id,
            user_id=user.user_id,
            notifications=payload.notifications,
            preferences=payload.preferences,
        )
        db.add(row)
    else:
        row.notifications = payload.notifications
        row.preferences = payload.preferences
    await db.commit()
    return payload

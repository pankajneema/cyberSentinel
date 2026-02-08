"""
Profile Management Routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

from utils.database import get_db
from models.auth_models import Profile, User
from utils.auth_utils import get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/v1/profile", tags=["Profile"])

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    country: Optional[str] = None

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

@router.get("")
async def get_profile(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current user's profile"""
    result = await db.execute(
        select(Profile).where(Profile.user_id == current_user["user_id"])
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found"
        )

    user_res = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    user = user_res.scalar_one_or_none()
    is_superadmin = False
    if user and user.company_id:
        from models.auth_models import Company
        company_owner_res = await db.execute(
            select(Company.owner_user_id).where(Company.id == user.company_id)
        )
        owner_id = company_owner_res.scalar_one_or_none()
        is_superadmin = owner_id == user.id
    
    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "full_name": profile.full_name,
        "email": profile.email,
        "role": profile.role,
        "is_superadmin": is_superadmin,
        "country": profile.country,
        "phone": profile.phone,
        "avatar_url": profile.avatar_url,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }

@router.put("")
async def update_profile(
    profile_data: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update current user's profile"""
    result = await db.execute(
        select(Profile).where(Profile.user_id == current_user["user_id"])
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found"
        )

    update_data = profile_data.dict(exclude_unset=True)
    if "email" in update_data and update_data["email"] != profile.email:
        email_check = await db.execute(
            select(User).where(User.email == update_data["email"])
        )
        existing_user = email_check.scalar_one_or_none()
        if existing_user and existing_user.id != profile.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
        user_result = await db.execute(
            select(User).where(User.id == profile.user_id)
        )
        user = user_result.scalar_one_or_none()
        if user:
            user.email = update_data["email"]
            user.updated_at = datetime.utcnow()
        profile.email = update_data["email"]
        update_data.pop("email", None)

    # Update remaining profile fields
    for key, value in update_data.items():
        setattr(profile, key, value)

    profile.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(profile)

    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "full_name": profile.full_name,
        "email": profile.email,
        "role": profile.role,
        "country": profile.country,
        "phone": profile.phone,
        "avatar_url": profile.avatar_url,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }

class AvatarUpdate(BaseModel):
    avatar_url: str

@router.patch("/avatar")
async def update_avatar(
    payload: AvatarUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update user's avatar URL"""
    result = await db.execute(
        select(Profile).where(Profile.user_id == current_user["user_id"])
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found"
        )

    profile.avatar_url = payload.avatar_url
    profile.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(profile)

    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "full_name": profile.full_name,
        "email": profile.email,
        "role": profile.role,
        "country": profile.country,
        "phone": profile.phone,
        "avatar_url": profile.avatar_url,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }

@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Change user's password"""
    result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Verify current password
    if not verify_password(password_data.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    # Update password
    user.hashed_password = hash_password(password_data.new_password)
    user.updated_at = datetime.utcnow()
    
    await db.commit()
    
    return {"message": "Password changed successfully"}

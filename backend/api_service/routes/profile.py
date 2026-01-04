"""
Profile Management Routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from utils.database import get_db
from models.auth_models import Profile, User
from utils.auth_utils import get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/v1/profile", tags=["Profile"])

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

@router.get("")
async def get_profile(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's profile"""
    profile = db.query(Profile).filter(Profile.user_id == current_user["id"]).first()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found"
        )
    
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

@router.put("")
async def update_profile(
    profile_data: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user's profile"""
    profile = db.query(Profile).filter(Profile.user_id == current_user["id"]).first()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found"
        )
    
    # Update profile fields
    update_data = profile_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(profile, key, value)
    
    profile.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(profile)
    
    return {
        "message": "Profile updated successfully",
        "profile": {
            "id": profile.id,
            "full_name": profile.full_name,
            "email": profile.email,
            "country": profile.country,
            "phone": profile.phone,
        }
    }

@router.patch("/avatar")
async def update_avatar(
    avatar_url: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user's avatar URL"""
    profile = db.query(Profile).filter(Profile.user_id == current_user["id"]).first()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found"
        )
    
    profile.avatar_url = avatar_url
    profile.updated_at = datetime.utcnow()
    
    db.commit()
    
    return {
        "message": "Avatar updated successfully",
        "avatar_url": avatar_url
    }

@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change user's password"""
    user = db.query(User).filter(User.id == current_user["id"]).first()
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
    
    db.commit()
    
    return {"message": "Password changed successfully"}
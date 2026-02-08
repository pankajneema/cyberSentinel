"""
User Management Routes - PostgreSQL Version
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from pydantic import BaseModel
from utils.database import get_db
from models.auth_models import User as UserModel
from utils.auth_utils import get_current_user

router = APIRouter(prefix="/api/v1/users", tags=["Users"])

class User(BaseModel):
    id: str
    name: str
    email: str
    role: str
    company_id: str | None

class UserUpdate(BaseModel):
    name: str = None
    role: str = None

@router.get("/me", response_model=User)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get current authenticated user information
    """
    result = await db.execute(
        select(UserModel).where(UserModel.id == current_user["user_id"])
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return User(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        company_id=getattr(user, "company_id", None),
    )

@router.get("", response_model=List[User])
async def list_users(
    skip: int = 0, 
    limit: int = 100, 
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List all users (paginated)
    """
    try:
        result = await db.execute(
            select(UserModel).offset(skip).limit(limit)
        )
        users = result.scalars().all()
        return [
            User(
                id=u.id,
                name=u.name,
                email=u.email,
                role=u.role,
                company_id=getattr(u, "company_id", None),
            )
            for u in users
        ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch users: {str(e)}"
        )

@router.get("/{user_id}", response_model=User)
async def get_user(
    user_id: str, 
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific user by ID
    """
    result = await db.execute(
        select(UserModel).where(UserModel.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return User(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        company_id=getattr(user, "company_id", None),
    )

@router.put("/{user_id}", response_model=User)
async def update_user(
    user_id: str, 
    user_data: UserUpdate, 
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update user information
    """
    # Find user
    result = await db.execute(
        select(UserModel).where(UserModel.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    current_user_result = await db.execute(
        select(UserModel).where(UserModel.id == current_user["user_id"])
    )
    current_user_record = current_user_result.scalar_one_or_none()
    if not current_user_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Current user not found"
        )

    # Check permission - users can only update their own profile unless admin
    if current_user_record.role != "admin" and current_user["user_id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this user"
        )
    
    # Update user data
    update_data = user_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)
    
    await db.commit()
    await db.refresh(user)
    
    return User(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        company_id=getattr(user, "company_id", None),
    )

@router.delete("/{user_id}")
async def delete_user(
    user_id: str, 
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a user
    """
    current_user_result = await db.execute(
        select(UserModel).where(UserModel.id == current_user["user_id"])
    )
    current_user_record = current_user_result.scalar_one_or_none()
    if not current_user_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Current user not found"
        )

    # Only admins can delete users
    if current_user_record.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can delete users"
        )
    
    # Find user
    result = await db.execute(
        select(UserModel).where(UserModel.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent self-deletion
    if current_user["user_id"] == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    
    await db.delete(user)
    await db.commit()
    
    return {"message": "User deleted successfully", "user_id": user_id}

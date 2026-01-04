"""
User Management Routes - PostgreSQL Version
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
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
    company_id: str

class UserUpdate(BaseModel):
    name: str = None
    role: str = None

@router.get("/me", response_model=User)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """
    Get current authenticated user information
    """
    return User(
        id=current_user["id"],
        name=current_user["name"],
        email=current_user["email"],
        role=current_user["role"],
        company_id=current_user["company_id"]
    )

@router.get("", response_model=List[User])
async def list_users(
    skip: int = 0, 
    limit: int = 100, 
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List all users (paginated)
    """
    try:
        users = db.query(UserModel).offset(skip).limit(limit).all()
        return [User(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            company_id=u.company_id
        ) for u in users]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch users: {str(e)}"
        )

@router.get("/{user_id}", response_model=User)
async def get_user(
    user_id: str, 
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get a specific user by ID
    """
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
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
        company_id=user.company_id
    )

@router.put("/{user_id}", response_model=User)
async def update_user(
    user_id: str, 
    user_data: UserUpdate, 
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update user information
    """
    # Find user
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Check permission - users can only update their own profile unless admin
    if current_user["id"] != user_id and current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this user"
        )
    
    # Update user data
    update_data = user_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)
    
    db.commit()
    db.refresh(user)
    
    return User(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        company_id=user.company_id
    )

@router.delete("/{user_id}")
async def delete_user(
    user_id: str, 
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a user
    """
    # Only admins can delete users
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can delete users"
        )
    
    # Find user
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent self-deletion
    if current_user["id"] == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    
    db.delete(user)
    db.commit()
    
    return {"message": "User deleted successfully", "user_id": user_id}
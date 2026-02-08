"""
Account Management Routes -
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from typing import List

from utils.database import get_db
from models.auth_models import Company, User
from utils.auth_utils import get_current_user

router = APIRouter(prefix="/api/v1/accounts", tags=["Accounts"])

class UserInfo(BaseModel):
    id: str
    name: str
    email: str
    role: str
    company_id: str

class AccountUpdate(BaseModel):
    name: str = None
    plan: str = None

class InviteMember(BaseModel):
    email: EmailStr
    role: str = "reader"

@router.get("/{account_id}")
async def get_account(
    account_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get account/company details"""
    current_user_result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    current_user_record = current_user_result.scalar_one_or_none()
    if not current_user_record or not current_user_record.company_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Verify user belongs to this company
    if current_user_record.company_id != account_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this account"
        )
    
    result = await db.execute(
        select(Company).where(Company.id == account_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )
    
    return {
        "id": account.id,
        "name": account.name,
        "plan": account.plan,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }

@router.put("/{account_id}")
async def update_account(
    account_id: str,
    account_data: AccountUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update account details"""
    current_user_result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    current_user_record = current_user_result.scalar_one_or_none()
    if not current_user_record or not current_user_record.company_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Only admins can update account
    if current_user_record.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can update account"
        )
    
    if current_user_record.company_id != account_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this account"
        )
    
    result = await db.execute(
        select(Company).where(Company.id == account_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )
    
    # Update fields
    update_data = account_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(account, key, value)
    
    await db.commit()
    await db.refresh(account)
    
    return {
        "id": account.id,
        "name": account.name,
        "plan": account.plan,
    }

@router.get("/{account_id}/members", response_model=List[UserInfo])
async def list_account_members(
    account_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List all members of an account"""
    current_user_result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    current_user_record = current_user_result.scalar_one_or_none()
    if not current_user_record or not current_user_record.company_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Verify user belongs to this company
    if current_user_record.company_id != account_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view members"
        )
    
    result = await db.execute(
        select(User).where(User.company_id == account_id)
    )
    users = result.scalars().all()
    
    return [
        UserInfo(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            company_id=u.company_id
        )
        for u in users
    ]

@router.post("/{account_id}/invite")
async def invite_member(
    account_id: str,
    payload: InviteMember,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Invite a new member to the account"""
    current_user_result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    current_user_record = current_user_result.scalar_one_or_none()
    if not current_user_record or not current_user_record.company_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Only admins can invite members
    if current_user_record.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can invite members"
        )
    
    if current_user_record.company_id != account_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to invite to this account"
        )
    
    # TODO: Send invitation email and create pending invitation
    
    return {
        "message": "Invitation sent successfully",
        "email": payload.email,
        "role": payload.role
    }

@router.delete("/{account_id}/members/{member_id}")
async def remove_member(
    account_id: str,
    member_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Remove a member from the account"""
    current_user_result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    current_user_record = current_user_result.scalar_one_or_none()
    if not current_user_record or not current_user_record.company_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    # Only admins can remove members
    if current_user_record.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can remove members"
        )
    
    if current_user_record.company_id != account_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized"
        )
    
    # Prevent self-removal
    if current_user["user_id"] == member_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove yourself"
        )
    
    result = await db.execute(
        select(User).where(
            User.id == member_id,
            User.company_id == account_id
        )
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found"
        )
    
    await db.delete(user)
    await db.commit()
    
    return {"message": "Member removed successfully"}

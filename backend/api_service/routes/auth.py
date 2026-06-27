"""
Authentication API
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import EmailStr
from datetime import datetime
import uuid

from utils.database import get_db
from models.auth_models import User, Profile, Company
from utils.auth_utils import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)

from schemas.auth_schema import (
    UserSignup,
    UserLogin,
    Token,
    MessageResponse,
)

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


# ---------------------------------------------------
# Signup
# ---------------------------------------------------
@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(
    user_data: UserSignup,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new user
    """

    # Check if user already exists
    result = await db.execute(
        select(User).where(User.email == user_data.email)
    )
    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    try:
        # Create company
        company = Company(
            id=str(uuid.uuid4()),
            name=user_data.company_name,
            plan="starter",
            created_at=datetime.utcnow(),
        )
        db.add(company)
        await db.flush()

        # Create user
        user = User(
            id=str(uuid.uuid4()),
            email=user_data.email,
            name=user_data.full_name,
            hashed_password=hash_password(user_data.password),
            role=user_data.role,
            company_id=company.id,
            is_active=True,
            created_at=datetime.utcnow(),
        )
        db.add(user)
        await db.flush()  # ensures user.id is available

        # Set company owner (superadmin)
        company.owner_user_id = user.id

        # Create profile
        profile = Profile(
            id=str(uuid.uuid4()),
            user_id=user.id,
            full_name=user_data.full_name,
            email=user_data.email,
            role=user_data.role,
            country=user_data.country,
        )
        db.add(profile)

        await db.commit()
        await db.refresh(user)

        return {
            "message": "User created successfully",
            "user_id": user.id,
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating user: {str(e)}",
        )


# ---------------------------------------------------
# Login
# ---------------------------------------------------
@router.post("/login", response_model=Token)
async def login(
    credentials: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticate user and return access token
    """

    result = await db.execute(
        select(User).where(User.email == credentials.email)
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(
        credentials.password,
        user.hashed_password,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    access_token = await create_access_token(
        data={
            "sub": user.email,
            "user_id": user.id,
        }
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "email": user.email,
        "user_id": user.id,
    }


# ---------------------------------------------------
# Logout / Magic-link / Refresh / Forgot / Reset
# ---------------------------------------------------
# REMOVED (Phase 1): these were non-functional stubs and a security risk
#   - /logout              was a no-op (no token revocation)
#   - /magic-link          never generated/sent anything
#   - /refresh             returned a literal fake token
#   - /forgot-password     did nothing
#   - /reset-password      reported success while doing nothing (dangerous)
# All of these are now handled entirely by Supabase via the frontend SDK
# (supabase.auth.*). Do not reintroduce credential logic in the backend.


# ---------------------------------------------------
# Verify JWT Token
# ---------------------------------------------------
@router.get("/verify")
async def verify_token(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Verify current access token and return user info
    """

    result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return {
        "valid": True,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        },
    }

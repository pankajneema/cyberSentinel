from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Literal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, not_

from utils.database import get_db
from utils.auth_utils import get_current_user
from models.asset_models import Asset as AssetModel


# -------------------- Schemas --------------------
from schemas.asset_schema import AssetCreateRequest, AssetUpdateRequest, AssetResponse, AssetListResponse

# -------------------- Routes --------------------
router = APIRouter(prefix="/api/v1/assets", tags=["Assets"])

# ---------------------------------------------------
# List Assets
# ---------------------------------------------------
@router.get("", response_model=AssetListResponse)
async def list_assets(
    q: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    exposure: Optional[str] = Query(None),
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(AssetModel).filter(
        AssetModel.user_id == current_user["user_id"]
    )

    if q:
        query = query.filter(AssetModel.name.ilike(f"%{q}%"))

    if type:
        query = query.filter(AssetModel.type == type)

    if exposure:
        query = query.filter(AssetModel.exposure == exposure)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # Get paginated results
    query = (
        query
        .order_by(AssetModel.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    
    result = await db.execute(query)
    assets = result.scalars().all()

    return AssetListResponse(
        items=[asset.to_dict() for asset in assets],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Create Asset
# ---------------------------------------------------
@router.post("", response_model=AssetResponse)
async def create_asset(
    payload: AssetCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    asset = AssetModel(
        user_id=current_user["user_id"],
        name=payload.name,
        type=payload.type,
        exposure=payload.exposure,
        tags=payload.tags or [],
        description=payload.description,
        status="active",
        risk_score=0,
    )

    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return asset.to_dict()


# ---------------------------------------------------
# Get Asset
# ---------------------------------------------------
@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(AssetModel).filter(
        AssetModel.id == asset_id,
        AssetModel.user_id == current_user["user_id"],
    )
    
    result = await db.execute(query)
    asset = result.scalar_one_or_none()

    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    return asset.to_dict()


# ---------------------------------------------------
# Update Asset
# ---------------------------------------------------
@router.patch("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: str,
    payload: AssetUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(AssetModel).filter(
        AssetModel.id == asset_id,
        AssetModel.user_id == current_user["user_id"],
    )
    
    result = await db.execute(query)
    asset = result.scalar_one_or_none()

    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    for key, value in payload.dict(exclude_unset=True).items():
        setattr(asset, key, value)

    await db.commit()
    await db.refresh(asset)

    return asset.to_dict()


# ---------------------------------------------------
# Delete Asset
# ---------------------------------------------------
@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(AssetModel).filter(
        AssetModel.id == asset_id,
        AssetModel.user_id == current_user["user_id"],
    )
    
    result = await db.execute(query)
    asset = result.scalar_one_or_none()

    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    #TODO check for the asset in uising in any discovey 
    await db.delete(asset)
    await db.commit()

    return {"message": "Asset deleted successfully"}
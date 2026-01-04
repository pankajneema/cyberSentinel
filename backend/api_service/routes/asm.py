# api/asm.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime

from utils.database import get_db
from utils.queue import publish_message
from utils.auth_utils import get_current_user
from models.asm_models import (
    AsmDiscovery as AsmDiscoveryModel,
    AsmDiscoveryRun as AsmDiscoveryRunModel,
)

# -------------------- Schemas -------------------- #
from schemas.asm_schema import (
    AsmDiscoveryCreateRequest,
    AsmDiscoveryUpdateRequest,
    AsmDiscoveryResponse,
    AsmDiscoveryListResponse,
    AsmDashboardResponse,
)

# -------------------- Router -------------------- #
router = APIRouter(prefix="/api/v1/asm", tags=["ASM"])


# ---------------------------------------------------
# Create Discovery
# ---------------------------------------------------
@router.post("/discoveries", response_model=AsmDiscoveryResponse)
async def create_discovery(
    payload: AsmDiscoveryCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    discovery = AsmDiscoveryModel(
        user_id=current_user["user_id"],
        name=payload.name,
        asset_type=payload.asset_type,
        target_source=payload.target_source,
        asset_ids=payload.asset_ids,
        manual_targets=payload.manual_targets,
        intensity=payload.intensity,
        schedule_type=payload.schedule_type,
        schedule_value=payload.schedule_value,
        next_run_at=datetime.utcnow(),
        status="PENDING",
    )

    # add() is NOT async
    db.add(discovery)
    await db.commit()
    await db.refresh(discovery)

    discovery_data = discovery.to_dict()

    # PUSH TO QUEUE
    queue_message = {
        "user_id": current_user["user_id"],
        "asm_discovery_id": discovery_data["id"],
        "asset_type": payload.asset_type,
        "target_source": payload.target_source,
        "intensity": payload.intensity,
    }

    queue_name = "asm.triggers"

    if not await publish_message(queue_name, queue_message):
        raise HTTPException(
            status_code=500,
            detail="Not able to schedule this discovery",
        )

    return discovery_data


# ---------------------------------------------------
# List Discoveries
# ---------------------------------------------------
@router.get("/discoveries", response_model=AsmDiscoveryListResponse)
async def list_discoveries(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    base_query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.user_id == current_user["user_id"]
    )

    # Total count
    total_query = select(func.count()).select_from(
        base_query.subquery()
    )
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Paginated results
    paginated_query = (
        base_query
        .order_by(AsmDiscoveryModel.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(paginated_query)
    discoveries = result.scalars().all()

    return AsmDiscoveryListResponse(
        items=[d.to_dict() for d in discoveries],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Update Discovery
# ---------------------------------------------------
@router.patch("/discoveries/{discovery_id}", response_model=AsmDiscoveryResponse)
async def update_discovery(
    discovery_id: str,
    payload: AsmDiscoveryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id == current_user["user_id"],
    )

    result = await db.execute(query)
    discovery = result.scalar_one_or_none()

    if not discovery:
        raise HTTPException(status_code=404, detail="Discovery not found")

    for key, value in payload.dict(exclude_unset=True).items():
        setattr(discovery, key, value)

    await db.commit()
    await db.refresh(discovery)

    return discovery.to_dict()


# ---------------------------------------------------
# Delete Discovery
# ---------------------------------------------------
@router.delete("/discoveries/{discovery_id}", response_model=AsmDiscoveryResponse)
async def delete_discovery(
    discovery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id == current_user["user_id"],
    )

    result = await db.execute(query)
    discovery = result.scalar_one_or_none()

    if not discovery:   
        raise HTTPException(status_code=404, detail="Discovery not found")

    await db.delete(discovery)
    await db.commit()

    return discovery.to_dict()  

# ---------------------------------------------------
# Dashboard
# ---------------------------------------------------
@router.get("/dashboard", response_model=AsmDashboardResponse)
async def asm_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    # Total discoveries
    total_query = select(func.count()).select_from(
        select(AsmDiscoveryModel)
        .where(AsmDiscoveryModel.user_id == user_id)
        .subquery()
    )
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Active discoveries
    active_query = select(func.count()).select_from(
        select(AsmDiscoveryModel)
        .where(
            AsmDiscoveryModel.user_id == user_id,
            AsmDiscoveryModel.status == "ACTIVE",
        )
        .subquery()
    )
    active_result = await db.execute(active_query)
    active = active_result.scalar() or 0

    # Last discovery run
    last_run_query = (
        select(AsmDiscoveryRunModel)
        .where(AsmDiscoveryRunModel.user_id == user_id)
        .order_by(AsmDiscoveryRunModel.started_at.desc())
        .limit(1)
    )
    last_run_result = await db.execute(last_run_query)
    last_run = last_run_result.scalar_one_or_none()

    return AsmDashboardResponse(
        attack_surface_score=75,  # placeholder
        total_discoveries=total,
        active_discoveries=active,
        last_discovery_run=last_run.started_at if last_run else None,
    )

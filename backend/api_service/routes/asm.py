# api/asm.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from sqlalchemy import select, func
from datetime import datetime

from utils.database import get_db
from utils.queue import publish_message
from utils.auth_utils import get_current_user
from models.asm_models import (
    AsmDiscovery as AsmDiscoveryModel,
    AsmDiscoveryRun as AsmDiscoveryRunModel,
    AsmSubdomain as AsmSubdomainModel,
    AsmIP as AsmIPModel,
)
from models.asset_models import Asset as AssetModel

# -------------------- Schemas -------------------- #
from schemas.asm_schema import (
    AsmDiscoveryCreateRequest,
    AsmDiscoveryUpdateRequest,
    AsmDiscoveryResponse,
    AsmDiscoveryListResponse,
    AsmDashboardResponse,
    AsmOverviewResponse,
    AsmSubdomainListResponse,
    AsmDiscoveryRunResponse,
    AsmDiscoveryRunListResponse,
    AsmIPListResponse,
    AsmIPResponse,
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
        "type":"asm",
        "user_id": current_user["user_id"],
        "id": discovery_data["id"],
        "asset_type": payload.asset_type,
        "target_source": payload.target_source,
        "intensity": payload.intensity,
    }

    queue_name = "jobs.asm"

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
# Get Discovery by ID
# ---------------------------------------------------
@router.get("/discoveries/{discovery_id}", response_model=AsmDiscoveryResponse)
async def get_discovery(
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

    return discovery.to_dict()


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
            AsmDiscoveryModel.status == "RUNNING",
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
        last_discovery_run=last_run.started_at.isoformat() if last_run and last_run.started_at else None,
    )


# ---------------------------------------------------
# Dashboard Overview (more metrics)
# ---------------------------------------------------
@router.get("/dashboard/overview", response_model=AsmOverviewResponse)
async def asm_overview(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    # total discoveries
    total_query = select(func.count()).select_from(
        select(AsmDiscoveryModel).where(AsmDiscoveryModel.user_id == user_id).subquery()
    )
    total = (await db.execute(total_query)).scalar() or 0

    # active discoveries
    active_query = select(func.count()).select_from(
        select(AsmDiscoveryModel).where(AsmDiscoveryModel.user_id == user_id, AsmDiscoveryModel.status == "RUNNING").subquery()
    )
    active = (await db.execute(active_query)).scalar() or 0

    # total subdomains (join with discoveries to ensure user scoping)
    subdomain_query = select(func.count()).select_from(
        select(AsmSubdomainModel).join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id).where(AsmDiscoveryModel.user_id == user_id).subquery()
    )
    total_subdomains = (await db.execute(subdomain_query)).scalar() or 0

    # total IPs (join with discoveries to ensure user scoping)
    ip_query = select(func.count()).select_from(
        select(AsmIPModel).join(AsmDiscoveryModel, AsmIPModel.asm_discovery_id == AsmDiscoveryModel.id).where(AsmDiscoveryModel.user_id == user_id).subquery()
    )
    total_ips_discovered = (await db.execute(ip_query)).scalar() or 0

    # last discovery run
    last_run_query = (
        select(AsmDiscoveryRunModel)
        .where(AsmDiscoveryRunModel.user_id == user_id)
        .order_by(AsmDiscoveryRunModel.started_at.desc())
        .limit(1)
    )
    last_run = (await db.execute(last_run_query)).scalar_one_or_none()

    # Asset counts
    total_assets_q = select(func.count()).select_from(select(AssetModel).where(AssetModel.user_id == user_id).subquery())
    total_assets = (await db.execute(total_assets_q)).scalar() or 0

    total_domains_q = select(func.count()).select_from(select(AssetModel).where(AssetModel.user_id == user_id, AssetModel.type == 'domain').subquery())
    total_domains = (await db.execute(total_domains_q)).scalar() or 0

    total_ips_q = select(func.count()).select_from(select(AssetModel).where(AssetModel.user_id == user_id, AssetModel.type == 'ip').subquery())
    total_ips = (await db.execute(total_ips_q)).scalar() or 0

    # services not modeled explicitly; default to 0
    total_services = 0

    # Exposure-based buckets (using risk_score as exposure_score for ASM)
    # High exposure: >= 75, Medium: 50-74, Low: < 50
    high_exposure_q = select(func.count()).select_from(select(AssetModel).where(AssetModel.user_id == user_id, AssetModel.risk_score >= 75).subquery())
    high_exposure_count = (await db.execute(high_exposure_q)).scalar() or 0
    
    medium_exposure_q = select(func.count()).select_from(select(AssetModel).where(AssetModel.user_id == user_id, AssetModel.risk_score.between(50, 74)).subquery())
    medium_exposure_count = (await db.execute(medium_exposure_q)).scalar() or 0
    
    low_exposure_count = total_assets - (high_exposure_count + medium_exposure_count)

    # Attack Surface Index: average exposure score (0-100)
    avg_q = select(func.avg(AssetModel.risk_score)).where(AssetModel.user_id == user_id)
    avg_res = await db.execute(avg_q)
    avg_score = avg_res.scalar() or 0
    attack_surface_index = int(avg_score)

    # Exposure summary
    public_assets_q = select(func.count()).select_from(select(AssetModel).where(AssetModel.user_id == user_id, AssetModel.exposure == 'public').subquery())
    public_assets = (await db.execute(public_assets_q)).scalar() or 0
    
    # Internet-facing services: for now, count public assets with service-like types
    # This is a placeholder - in a real system, you'd have a services table
    internet_facing_services = 0
    
    # Unknown ownership: assets without clear ownership tags
    unknown_assets_q = select(func.count()).select_from(select(AssetModel).where(AssetModel.user_id == user_id, AssetModel.tags == []).subquery())
    unknown_assets = (await db.execute(unknown_assets_q)).scalar() or 0

    # Top exposed assets by exposure_score (mapped from risk_score)
    top_q = select(AssetModel).where(AssetModel.user_id == user_id).order_by(AssetModel.risk_score.desc()).limit(5)
    top_res = await db.execute(top_q)
    top_assets_raw = top_res.scalars().all()
    
    # Map to exposure-based structure
    top_exposed_assets = []
    for asset in top_assets_raw:
        asset_dict = asset.to_dict()
        # Map risk_score to exposure_score for ASM
        asset_dict["exposure_score"] = asset_dict.pop("risk_score", 0)
        top_exposed_assets.append(asset_dict)

    # Exposure breakdown
    exposure_breakdown = [
        {"label": "high", "count": int(high_exposure_count)},
        {"label": "medium", "count": int(medium_exposure_count)},
        {"label": "low", "count": int(low_exposure_count)},
    ]

    return AsmOverviewResponse(
        attack_surface_index=attack_surface_index,
        total_discoveries=total,
        active_discoveries=active,
        last_discovery_run=last_run.started_at.isoformat() if last_run and last_run.started_at else None,
        asset_counts={
            "domains": total_domains,
            "subdomains": total_subdomains,
            "ips": total_ips_discovered,  # Use discovered IPs from ASM, not asset inventory
            "services": total_services,
            "assets_total": total_assets,
        },
        exposure_summary={
            "public_assets": public_assets,
            "internet_facing_services": internet_facing_services,
            "unknown_assets": unknown_assets,
        },
        exposure_breakdown=exposure_breakdown,
        exposure_trend=0,
        top_exposed_assets=top_exposed_assets,
        recent_activity=[],
    )


# ---------------------------------------------------
# Subdomains list for dashboard
# ---------------------------------------------------
@router.get("/subdomains", response_model=AsmSubdomainListResponse)
async def list_subdomains(
    discovery_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,  # Reduced default for performance (was 50, keeping it)
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    List subdomains with pagination.
    
    Performance: Uses pagination to handle large datasets (250+ subdomains).
    Max page_size is 100 to prevent UI crashes.
    """
    user_id = current_user["user_id"]
    
    # Enforce max page_size for performance
    if page_size > 100:
        page_size = 100

    # Base query: join to ensure user scoping and include asset info
    base = (
        select(AsmSubdomainModel, AssetModel.name.label("asset_name"), AssetModel.type.label("asset_type"))
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .outerjoin(AssetModel, AsmSubdomainModel.asset_id == AssetModel.id)
        .where(AsmDiscoveryModel.user_id == user_id)
    )

    if discovery_id:
        base = base.where(AsmSubdomainModel.asm_discovery_id == discovery_id)

    # Optimized count query (separate, faster)
    total_base = (
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id == user_id)
    )
    if discovery_id:
        total_base = total_base.where(AsmSubdomainModel.asm_discovery_id == discovery_id)
    
    total_q = select(func.count()).select_from(total_base.subquery())
    total = (await db.execute(total_q)).scalar() or 0

    # Paginated query with limit
    paginated = base.order_by(AsmSubdomainModel.created_at.desc()).offset((page-1)*page_size).limit(page_size)
    result = await db.execute(paginated)
    rows = result.all()

    # Get subdomain IDs for IP count lookup
    subdomain_ids = [row[0].id for row in rows]
    
    # Batch fetch IP counts for all subdomains in this page (performance optimization)
    ip_counts = {}
    if subdomain_ids:
        ip_count_query = (
            select(AsmIPModel.subdomain_id, func.count(AsmIPModel.id).label("ip_count"))
            .where(AsmIPModel.subdomain_id.in_(subdomain_ids))
            .group_by(AsmIPModel.subdomain_id)
        )
        ip_count_result = await db.execute(ip_count_query)
        ip_counts = {row.subdomain_id: row.ip_count for row in ip_count_result.all()}

    items = []
    for row in rows:
        subdomain_dict = row[0].to_dict()
        subdomain_dict["asset_name"] = row.asset_name
        subdomain_dict["asset_type"] = row.asset_type
        subdomain_dict["ip_count"] = ip_counts.get(subdomain_dict["id"], 0)  # Add IP count
        items.append(subdomain_dict)

    return AsmSubdomainListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# IPs list for a specific subdomain (HIERARCHY: Subdomain → IPs)
# ---------------------------------------------------
@router.get("/subdomains/{subdomain_id}/ips", response_model=AsmIPListResponse)
async def list_subdomain_ips(
    subdomain_id: str,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    List IPs for a specific subdomain.
    
    HIERARCHY: Domain → Subdomain → IP
    This endpoint shows IPs that belong to a subdomain.
    IPs are derived from DNS resolution of the subdomain.
    
    Risk flows bottom-up: IP exposure → Subdomain exposure → Domain exposure
    """
    user_id = current_user["user_id"]
    
    # Enforce max page_size
    if page_size > 100:
        page_size = 100
    
    # Verify subdomain exists and user has access
    subdomain_query = (
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(
            AsmSubdomainModel.id == subdomain_id,
            AsmDiscoveryModel.user_id == user_id
        )
    )
    subdomain_result = await db.execute(subdomain_query)
    subdomain = subdomain_result.scalar_one_or_none()
    
    if not subdomain:
        raise HTTPException(status_code=404, detail="Subdomain not found or access denied")
    
    # Get IPs for this subdomain
    base_query = select(AsmIPModel).where(AsmIPModel.subdomain_id == subdomain_id)
    
    # Total count
    total_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    # Paginated results
    paginated_query = (
        base_query
        .order_by(AsmIPModel.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    
    result = await db.execute(paginated_query)
    ips = result.scalars().all()
    
    items = []
    for ip in ips:
        ip_dict = ip.to_dict()
        items.append(AsmIPResponse(**ip_dict))
    
    return AsmIPListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Get single subdomain with IPs (for detail view)
# ---------------------------------------------------
@router.get("/subdomains/{subdomain_id}", response_model=dict)
async def get_subdomain_detail(
    subdomain_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Get subdomain detail with IP count and basic IP info.
    
    Returns subdomain info with:
    - IP count (for UI display)
    - First few IPs (preview)
    """
    user_id = current_user["user_id"]
    
    # Get subdomain with user verification
    subdomain_query = (
        select(AsmSubdomainModel, AssetModel.name.label("asset_name"), AssetModel.type.label("asset_type"))
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .outerjoin(AssetModel, AsmSubdomainModel.asset_id == AssetModel.id)
        .where(
            AsmSubdomainModel.id == subdomain_id,
            AsmDiscoveryModel.user_id == user_id
        )
    )
    subdomain_result = await db.execute(subdomain_query)
    row = subdomain_result.first()
    
    if not row:
        raise HTTPException(status_code=404, detail="Subdomain not found")
    
    subdomain = row[0]
    
    # Get IP count
    ip_count_query = select(func.count(AsmIPModel.id)).where(AsmIPModel.subdomain_id == subdomain_id)
    ip_count_result = await db.execute(ip_count_query)
    ip_count = ip_count_result.scalar() or 0
    
    # Get first 5 IPs for preview
    preview_ips_query = (
        select(AsmIPModel)
        .where(AsmIPModel.subdomain_id == subdomain_id)
        .order_by(AsmIPModel.created_at.desc())
        .limit(5)
    )
    preview_ips_result = await db.execute(preview_ips_query)
    preview_ips = preview_ips_result.scalars().all()
    
    subdomain_dict = subdomain.to_dict()
    subdomain_dict["asset_name"] = row.asset_name
    subdomain_dict["asset_type"] = row.asset_type
    subdomain_dict["ip_count"] = ip_count
    subdomain_dict["preview_ips"] = [ip.to_dict() for ip in preview_ips]
    
    return subdomain_dict


# ---------------------------------------------------
# List all IPs (for IPs tab)
# ---------------------------------------------------
@router.get("/ips", response_model=AsmIPListResponse)
async def list_all_ips(
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    List all IPs discovered by the user.
    
    Shows all IPs across all discoveries, with pagination.
    """
    user_id = current_user["user_id"]
    
    # Enforce max page_size
    if page_size > 100:
        page_size = 100
    
    # Get all discovery IDs owned by the user
    disc_query = select(AsmDiscoveryModel.id).where(AsmDiscoveryModel.user_id == user_id)
    disc_result = await db.execute(disc_query)
    discovery_ids = [row[0] for row in disc_result.all()]
    
    if not discovery_ids:
        return AsmIPListResponse(
            items=[],
            total=0,
            page=page,
            page_size=page_size,
        )
    
    # Get IPs for these discoveries
    base_query = select(AsmIPModel).where(AsmIPModel.asm_discovery_id.in_(discovery_ids))
    
    # Total count
    total_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    # Paginated results
    paginated_query = (
        base_query
        .order_by(AsmIPModel.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    
    result = await db.execute(paginated_query)
    ips = result.scalars().all()
    
    items = []
    for ip in ips:
        ip_dict = ip.to_dict()
        items.append(AsmIPResponse(**ip_dict))
    
    return AsmIPListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Discovery Runs list (for a specific discovery)
# ---------------------------------------------------
@router.get("/discoveries/{discovery_id}/runs", response_model=AsmDiscoveryRunListResponse)
async def list_discovery_runs(
    discovery_id: str,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    # Ensure user owns the discovery
    disc_q = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id == user_id
    )
    disc_res = await db.execute(disc_q)
    disc = disc_res.scalar_one_or_none()
    if not disc:
        raise HTTPException(status_code=404, detail="Discovery not found")

    # Get runs for this discovery
    base_query = select(AsmDiscoveryRunModel).where(
        AsmDiscoveryRunModel.asm_discovery_id == discovery_id
    )

    # Total count
    total_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Paginated results
    paginated_query = (
        base_query
        .order_by(AsmDiscoveryRunModel.started_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(paginated_query)
    runs = result.scalars().all()

    return AsmDiscoveryRunListResponse(
        items=[AsmDiscoveryRunResponse(
            id=run.id,
            asm_discovery_id=run.asm_discovery_id,
            user_id=run.user_id,
            triggered_by=run.triggered_by,
            run_mode=run.run_mode,
            status=run.status,
            started_at=run.started_at.isoformat() if run.started_at else None,
            completed_at=run.completed_at.isoformat() if run.completed_at else None,
            error_message=run.error_message,
            summary=run.summary,
            created_at=run.created_at.isoformat() if run.created_at else None,
        ) for run in runs],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# List all Discovery Runs (for Reports tab)
# ---------------------------------------------------
@router.get("/runs", response_model=AsmDiscoveryRunListResponse)
async def list_all_discovery_runs(
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    # Get all runs for discoveries owned by the user
    # First, get all discovery IDs owned by the user
    disc_query = select(AsmDiscoveryModel.id).where(AsmDiscoveryModel.user_id == user_id)
    disc_result = await db.execute(disc_query)
    discovery_ids = [row[0] for row in disc_result.all()]

    if not discovery_ids:
        return AsmDiscoveryRunListResponse(
            items=[],
            total=0,
            page=page,
            page_size=page_size,
        )

    # Get runs for these discoveries
    base_query = select(AsmDiscoveryRunModel).where(
        AsmDiscoveryRunModel.asm_discovery_id.in_(discovery_ids)
    )

    # Total count
    total_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Paginated results
    paginated_query = (
        base_query
        .order_by(AsmDiscoveryRunModel.started_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(paginated_query)
    runs = result.scalars().all()

    return AsmDiscoveryRunListResponse(
        items=[AsmDiscoveryRunResponse(
            id=run.id,
            asm_discovery_id=run.asm_discovery_id,
            user_id=run.user_id,
            triggered_by=run.triggered_by,
            run_mode=run.run_mode,
            status=run.status,
            started_at=run.started_at.isoformat() if run.started_at else None,
            completed_at=run.completed_at.isoformat() if run.completed_at else None,
            error_message=run.error_message,
            summary=run.summary,
            created_at=run.created_at.isoformat() if run.created_at else None,
        ) for run in runs],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Discovery Run detail (for "complete view")
# ---------------------------------------------------
@router.get("/runs/{run_id}", response_model=AsmDiscoveryRunResponse)
async def get_run_detail(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = select(AsmDiscoveryRunModel).where(AsmDiscoveryRunModel.id == run_id)
    result = await db.execute(query)
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Ensure user owns the discovery
    disc_q = select(AsmDiscoveryModel).where(AsmDiscoveryModel.id == run.asm_discovery_id, AsmDiscoveryModel.user_id == current_user["user_id"])
    disc_res = await db.execute(disc_q)
    disc = disc_res.scalar_one_or_none()
    if not disc:
        raise HTTPException(status_code=403, detail="forbidden")

    return AsmDiscoveryRunResponse(
        id=run.id,
        asm_discovery_id=run.asm_discovery_id,
        user_id=run.user_id,
        triggered_by=run.triggered_by,
        run_mode=run.run_mode,
        status=run.status,
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        error_message=run.error_message,
        summary=run.summary,
        created_at=run.created_at.isoformat() if run.created_at else None,
    )


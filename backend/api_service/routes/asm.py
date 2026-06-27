# api/asm.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from sqlalchemy import select, func, or_
from datetime import datetime

from utils.database import get_db
from utils.queue import publish_message
from utils.auth_utils import get_current_user
from models.asm_models import (
    AsmDiscovery as AsmDiscoveryModel,
    AsmDiscoveryRun as AsmDiscoveryRunModel,
    AsmSubdomain as AsmSubdomainModel,
    AsmIP as AsmIPModel,
    AsmPort as AsmPortModel,
    AsmSettings as AsmSettingsModel,
    AsmService as AsmServiceModel,
    AsmSSLCert as AsmSSLCertModel,
    AsmAPIEndpoint as AsmAPIEndpointModel,
    AsmCloudResource as AsmCloudResourceModel,
    AsmAdminEndpoint as AsmAdminEndpointModel,
    AsmBackupFile as AsmBackupFileModel,
    AsmChange as AsmChangeModel,
    AsmRepoFinding as AsmRepoFindingModel,
    AsmSaasApp as AsmSaasAppModel,
    AsmUserAccount as AsmUserAccountModel,
)
from models.asset_models import Asset as AssetModel
from models.auth_models import User as UserModel
from models.tenancy_models import MemberProfile, AuditLog
from scoring import score_exposure, AssetSignals

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
    AsmPortListResponse,
    AsmPortResponse,
    AsmServiceListResponse,
    AsmServiceResponse,
    AsmSSLCertListResponse,
    AsmSSLCertResponse,
    AsmAPIEndpointListResponse,
    AsmAPIEndpointResponse,
    AsmCloudResourceListResponse,
    AsmCloudResourceResponse,
    AsmAdminEndpointListResponse,
    AsmAdminEndpointResponse,
    AsmBackupFileListResponse,
    AsmBackupFileResponse,
    AsmChangeListResponse,
    AsmChangeResponse,
)

# -------------------- Router -------------------- #
router = APIRouter(prefix="/api/v1/asm", tags=["ASM"])


# ---------------------------------------------------
# Helpers
# ---------------------------------------------------
def _calc_duration_seconds(run: AsmDiscoveryRunModel) -> int | None:
    if not run.started_at:
        return None
    if not run.completed_at:
        return None
    return int((run.completed_at - run.started_at).total_seconds())


async def _company_user_ids(
    db: AsyncSession,
    current_user: dict,
) -> list[str]:
    """
    Return the Supabase user-ids of every member in the caller's organization.

    Tenancy scoping: ASM data is created with the creator's Supabase `user_id`,
    and creators are org members — so filtering existing queries by
    `user_id.in_(these ids)` scopes everything to the org (org_id tenancy).
    """
    org_id = current_user.get("org_id")
    self_id = current_user.get("user_id")

    if not org_id:
        # No org context yet — only the caller's own data.
        return [self_id] if self_id else []

    rows = await db.execute(
        select(MemberProfile.supabase_user_id).where(
            MemberProfile.org_id == org_id,
            MemberProfile.deleted_at.is_(None),
        )
    )
    ids = [r[0] for r in rows.all()]
    if self_id and self_id not in ids:
        ids.append(self_id)
    return ids


async def _require_write_access(
    db: AsyncSession,
    current_user: dict,
):
    # RBAC from the verified identity (owner/admin/analyst may write; reader cannot).
    role = current_user.get("role", "reader")
    if role not in ("owner", "admin", "analyst"):
        raise HTTPException(status_code=403, detail="Read-only access for your role")
    return current_user


async def _user_discovery_ids(db: AsyncSession, user_ids: list[str]) -> list[str]:
    disc_query = select(AsmDiscoveryModel.id).where(AsmDiscoveryModel.user_id.in_(user_ids))
    disc_result = await db.execute(disc_query)
    return [row[0] for row in disc_result.all()]


# ---------------------------------------------------
# ASM Settings
# ---------------------------------------------------
@router.get("/settings")
async def get_asm_settings(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    query = (
        select(AsmSettingsModel)
        .where(AsmSettingsModel.user_id == user_id)
        .order_by(AsmSettingsModel.updated_at.desc(), AsmSettingsModel.created_at.desc())
        .limit(1)
    )
    result = await db.execute(query)
    settings_row = result.scalars().first()

    if settings_row:
        return settings_row.to_dict()

    # Default settings if none saved
    default_settings = {
        "thresholds": {
            "critical": 80,
            "high": 60,
            "medium": 40,
        },
        "signals": {
            "internet_facing": 30,
            "open_ports": 25,
            "ssl_issues": 15,
            "public_cloud": 15,
            "admin_or_backup": 10,
            "api_exposure": 5,
        },
    }
    return {
        "id": None,
        "user_id": user_id,
        "settings": default_settings,
        "created_at": None,
        "updated_at": None,
    }


@router.put("/settings")
async def update_asm_settings(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _require_write_access(db, current_user)
    user_id = current_user["user_id"]
    query = (
        select(AsmSettingsModel)
        .where(AsmSettingsModel.user_id == user_id)
        .order_by(AsmSettingsModel.updated_at.desc(), AsmSettingsModel.created_at.desc())
        .limit(1)
    )
    result = await db.execute(query)
    settings_row = result.scalars().first()

    if settings_row:
        settings_row.settings = payload
    else:
        settings_row = AsmSettingsModel(
            user_id=user_id,
            settings=payload,
        )
        db.add(settings_row)

    await db.commit()
    await db.refresh(settings_row)
    return settings_row.to_dict()


# ---------------------------------------------------
# Create Discovery
# ---------------------------------------------------
@router.post("/discoveries", response_model=AsmDiscoveryResponse)
async def create_discovery(
    payload: AsmDiscoveryCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _require_write_access(db, current_user)
    discovery = AsmDiscoveryModel(
        user_id=current_user["user_id"],
        org_id=current_user.get("org_id"),
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
# Exposure Signals (defensible CVSS/EPSS/KEV-aware scoring)
# ---------------------------------------------------
@router.get("/exposure")
async def asm_exposure(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Per-IP exposure scored with the defensible model in `scoring/exposure.py`
    (open ports/sensitive services + TLS posture + context), replacing the
    legacy magic-number score. Returns the factor breakdown so the UI can show
    *why* each asset scored what it did.
    """
    user_ids = await _company_user_ids(db, current_user)
    discovery_ids = await _user_discovery_ids(db, user_ids)
    if not discovery_ids:
        return {"items": [], "total": 0, "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}}

    ips = (await db.execute(
        select(AsmIPModel).where(AsmIPModel.asm_discovery_id.in_(discovery_ids))
    )).scalars().all()
    if not ips:
        return {"items": [], "total": 0, "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}}

    open_ports = (await db.execute(
        select(AsmPortModel).where(
            AsmPortModel.asm_discovery_id.in_(discovery_ids),
            AsmPortModel.status == "open",
        )
    )).scalars().all()
    ports_by_ip: dict[str, list[int]] = {}
    services_by_ip: dict[str, list[str]] = {}
    for p in open_ports:
        ports_by_ip.setdefault(p.ip_address, []).append(p.port)
        if p.service:
            services_by_ip.setdefault(p.ip_address, []).append(p.service)

    certs = (await db.execute(
        select(AsmSSLCertModel).where(AsmSSLCertModel.asm_discovery_id.in_(discovery_ids))
    )).scalars().all()
    tls_by_host: dict[str, list[str]] = {}
    now = datetime.utcnow()
    for c in certs:
        if c.valid_until and c.valid_until < now:
            tls_by_host.setdefault(c.host, []).append("expired")

    summary = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    items = []
    for ip in ips:
        addr = ip.ip_address
        sc = score_exposure(AssetSignals(
            open_ports=ports_by_ip.get(addr, []),
            services=services_by_ip.get(addr, []),
            is_public=True,                 # externally-discovered = internet-facing
            tls_issues=tls_by_host.get(addr, []),
            asset_criticality="normal",
        ))
        summary[sc.severity] = summary.get(sc.severity, 0) + 1
        items.append({
            "ip_address": addr,
            "country": ip.country,
            "country_code": ip.country_code,
            "asn": ip.asn,
            "asn_org": ip.asn_org,
            "open_ports": sorted(ports_by_ip.get(addr, [])),
            "score": sc.score,
            "severity": sc.severity,
            "factors": sc.to_dict()["factors"],
        })

    items.sort(key=lambda r: r["score"], reverse=True)
    return {"items": items[:limit], "total": len(items), "summary": summary}


# ---------------------------------------------------
# List Discoveries
# ---------------------------------------------------
@router.get("/discoveries", response_model=AsmDiscoveryListResponse)
async def list_discoveries(
    page: int = 1,
    page_size: int = 20,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    base_query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.user_id.in_(user_ids)
    )
    if q:
        like = f"%{q}%"
        base_query = base_query.where(
            or_(
                AsmDiscoveryModel.name.ilike(like),
                AsmDiscoveryModel.status.ilike(like),
                AsmDiscoveryModel.asset_type.ilike(like),
            )
        )

    # Total count
    total_query = select(func.count()).select_from(
        base_query.subquery()
    )
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Paginated results
    sort_col = AsmDiscoveryModel.created_at
    if sort_by == "name":
        sort_col = AsmDiscoveryModel.name
    elif sort_by == "status":
        sort_col = AsmDiscoveryModel.status
    elif sort_by == "asset_type":
        sort_col = AsmDiscoveryModel.asset_type
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    paginated_query = (
        base_query
        .order_by(sort_col)
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
    user_ids = await _company_user_ids(db, current_user)
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id.in_(user_ids),
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
    await _require_write_access(db, current_user)
    user_ids = await _company_user_ids(db, current_user)
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id.in_(user_ids),
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
# Run / Re-run Discovery (manual trigger)
# ---------------------------------------------------
@router.post("/discoveries/{discovery_id}/run", response_model=AsmDiscoveryResponse)
async def run_discovery(
    discovery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Manually (re-)queue an existing discovery for immediate execution.

    Mirrors the create-time enqueue: marks the discovery PENDING with an
    immediate next_run_at and publishes the same job message the worker
    consumes. Scoped to the caller's org via _company_user_ids.
    """
    await _require_write_access(db, current_user)
    user_ids = await _company_user_ids(db, current_user)
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id.in_(user_ids),
    )
    result = await db.execute(query)
    discovery = result.scalar_one_or_none()

    if not discovery:
        raise HTTPException(status_code=404, detail="Discovery not found")

    discovery.status = "PENDING"
    discovery.next_run_at = datetime.utcnow()
    await db.commit()
    await db.refresh(discovery)

    queue_message = {
        "type": "asm",
        "user_id": discovery.user_id,
        "id": discovery.id,
        "asset_type": discovery.asset_type,
        "target_source": discovery.target_source,
        "intensity": discovery.intensity,
    }
    if not await publish_message("jobs.asm", queue_message):
        raise HTTPException(status_code=500, detail="Not able to schedule this discovery")

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
    await _require_write_access(db, current_user)
    user_ids = await _company_user_ids(db, current_user)
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id.in_(user_ids),
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
    user_ids = await _company_user_ids(db, current_user)

    # Total discoveries
    total_query = select(func.count()).select_from(
        select(AsmDiscoveryModel)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
        .subquery()
    )
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Active discoveries
    active_query = select(func.count()).select_from(
        select(AsmDiscoveryModel)
        .where(
            AsmDiscoveryModel.user_id.in_(user_ids),
            AsmDiscoveryModel.status == "RUNNING",
        )
        .subquery()
    )
    active_result = await db.execute(active_query)
    active = active_result.scalar() or 0

    # Last discovery run
    last_run_query = (
        select(AsmDiscoveryRunModel)
        .where(AsmDiscoveryRunModel.user_id.in_(user_ids))
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
    user_ids = await _company_user_ids(db, current_user)

    # total discoveries
    total_query = select(func.count()).select_from(
        select(AsmDiscoveryModel).where(AsmDiscoveryModel.user_id.in_(user_ids)).subquery()
    )
    total = (await db.execute(total_query)).scalar() or 0

    # active discoveries
    active_query = select(func.count()).select_from(
        select(AsmDiscoveryModel).where(AsmDiscoveryModel.user_id.in_(user_ids), AsmDiscoveryModel.status == "RUNNING").subquery()
    )
    active = (await db.execute(active_query)).scalar() or 0

    # total subdomains (join with discoveries to ensure user scoping)
    subdomain_query = select(func.count()).select_from(
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
        .subquery()
    )
    total_subdomains = (await db.execute(subdomain_query)).scalar() or 0

    # total IPs (join with discoveries to ensure user scoping)
    ip_query = select(func.count()).select_from(
        select(AsmIPModel)
        .join(AsmDiscoveryModel, AsmIPModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
        .subquery()
    )
    total_ips_discovered = (await db.execute(ip_query)).scalar() or 0

    # last discovery run
    last_run_query = (
        select(AsmDiscoveryRunModel)
        .where(AsmDiscoveryRunModel.user_id.in_(user_ids))
        .order_by(AsmDiscoveryRunModel.started_at.desc())
        .limit(1)
    )
    last_run = (await db.execute(last_run_query)).scalar_one_or_none()
    

    # Asset counts
    total_assets_q = select(func.count()).select_from(
        select(AssetModel).where(AssetModel.user_id.in_(user_ids)).subquery()
    )
    total_assets = (await db.execute(total_assets_q)).scalar() or 0

    total_domains_q = select(func.count()).select_from(
        select(AssetModel).where(AssetModel.user_id.in_(user_ids), AssetModel.type == 'domain').subquery()
    )
    total_domains = (await db.execute(total_domains_q)).scalar() or 0

    total_cloud_q = select(func.count()).select_from(
        select(AssetModel).where(AssetModel.user_id.in_(user_ids), AssetModel.type == 'cloud').subquery()
    )
    total_cloud = (await db.execute(total_cloud_q)).scalar() or 0

    total_ips_q = select(func.count()).select_from(
        select(AssetModel).where(AssetModel.user_id.in_(user_ids), AssetModel.type == 'ip').subquery()
    )
    total_ips = (await db.execute(total_ips_q)).scalar() or 0

    # services not modeled explicitly; default to 0
    total_services = 0

    # Load ASM settings for thresholds
    settings_query = (
        select(AsmSettingsModel)
        .where(AsmSettingsModel.user_id.in_(user_ids))
        .order_by(AsmSettingsModel.updated_at.desc(), AsmSettingsModel.created_at.desc())
        .limit(1)
    )
    settings_result = await db.execute(settings_query)
    settings_row = settings_result.scalars().first()
    thresholds = {
        "critical": 80,
        "high": 60,
        "medium": 40,
    }
    if settings_row and isinstance(settings_row.settings, dict):
        thresholds.update(settings_row.settings.get("thresholds", {}) or {})

    critical_threshold = int(thresholds.get("critical", 80))
    high_threshold = int(thresholds.get("high", 60))
    medium_threshold = int(thresholds.get("medium", 40))

    # Exposure-based buckets (using exposure_score mapped from risk_score for ASM)
    high_exposure_q = select(func.count()).select_from(
        select(AssetModel).where(
            AssetModel.user_id.in_(user_ids),
            AssetModel.risk_score >= high_threshold
        ).subquery()
    )
    high_exposure_count = (await db.execute(high_exposure_q)).scalar() or 0
    
    medium_exposure_q = select(func.count()).select_from(
        select(AssetModel).where(
            AssetModel.user_id.in_(user_ids),
            AssetModel.risk_score.between(medium_threshold, high_threshold - 1)
        ).subquery()
    )
    medium_exposure_count = (await db.execute(medium_exposure_q)).scalar() or 0
    
    low_exposure_count = total_assets - (high_exposure_count + medium_exposure_count)

    # Attack Surface Index: average exposure score (0-100)
    avg_q = select(func.avg(AssetModel.risk_score)).where(AssetModel.user_id.in_(user_ids))
    avg_res = await db.execute(avg_q)
    avg_score = avg_res.scalar() or 0
    attack_surface_index = int(avg_score)

    # Exposure summary
    public_assets_q = select(func.count()).select_from(
        select(AssetModel).where(AssetModel.user_id.in_(user_ids), AssetModel.exposure == 'public').subquery()
    )
    public_assets = (await db.execute(public_assets_q)).scalar() or 0
    
    # Internet-facing services: for now, count public assets with service-like types
    # This is a placeholder - in a real system, you'd have a services table
    internet_facing_services = 0
    
    # Unknown ownership: assets without clear ownership tags
    unknown_assets_q = select(func.count()).select_from(
        select(AssetModel).where(AssetModel.user_id.in_(user_ids), AssetModel.tags == []).subquery()
    )
    unknown_assets = (await db.execute(unknown_assets_q)).scalar() or 0

    # Top exposed assets by exposure_score (mapped from risk_score)
    top_q = select(AssetModel).where(AssetModel.user_id.in_(user_ids)).order_by(AssetModel.risk_score.desc()).limit(5)
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

    # Recent activity — real org events from the audit trail (last ~10).
    recent_activity = []
    org_id = current_user.get("org_id")
    if org_id:
        recent_logs = (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.org_id == org_id)
                .order_by(AuditLog.created_at.desc())
                .limit(10)
            )
        ).scalars().all()
        recent_activity = [
            {
                "id": log.id,
                "action": log.action,
                "asset": log.target,
                "time": log.created_at.isoformat() if log.created_at else None,
                "type": (log.action or "").split(".")[0] or log.action,
            }
            for log in recent_logs
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
            "cloud": total_cloud,
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
        recent_activity=recent_activity,
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
    user_ids = await _company_user_ids(db, current_user)
    
    # Enforce max page_size for performance
    if page_size > 100:
        page_size = 100

    # Base query: join to ensure user scoping and include asset info
    base = (
        select(AsmSubdomainModel, AssetModel.name.label("asset_name"), AssetModel.type.label("asset_type"))
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .outerjoin(AssetModel, AsmSubdomainModel.asset_id == AssetModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )

    if discovery_id:
        base = base.where(AsmSubdomainModel.asm_discovery_id == discovery_id)

    # Optimized count query (separate, faster)
    total_base = (
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
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
    user_ids = await _company_user_ids(db, current_user)
    
    # Enforce max page_size
    if page_size > 100:
        page_size = 100
    
    # Verify subdomain exists and user has access
    subdomain_query = (
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(
            AsmSubdomainModel.id == subdomain_id,
            AsmDiscoveryModel.user_id.in_(user_ids)
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

    # Batch open port counts for these IPs
    open_port_counts = {}
    if ips:
        asset_ids = list({ip.asset_id for ip in ips})
        ip_addresses = list({ip.ip_address for ip in ips})
        port_count_query = (
            select(AsmPortModel.asset_id, AsmPortModel.ip_address, func.count(AsmPortModel.id).label("port_count"))
            .where(
                AsmPortModel.asset_id.in_(asset_ids),
                AsmPortModel.ip_address.in_(ip_addresses),
            )
            .group_by(AsmPortModel.asset_id, AsmPortModel.ip_address)
        )
        port_count_result = await db.execute(port_count_query)
        open_port_counts = {
            (row.asset_id, row.ip_address): row.port_count for row in port_count_result.all()
        }
    
    items = []
    for ip in ips:
        ip_dict = ip.to_dict()
        ip_dict["open_ports"] = open_port_counts.get((ip.asset_id, ip.ip_address), 0)
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
    user_ids = await _company_user_ids(db, current_user)
    
    # Get subdomain with user verification
    subdomain_query = (
        select(AsmSubdomainModel, AssetModel.name.label("asset_name"), AssetModel.type.label("asset_type"))
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .outerjoin(AssetModel, AsmSubdomainModel.asset_id == AssetModel.id)
        .where(
            AsmSubdomainModel.id == subdomain_id,
            AsmDiscoveryModel.user_id.in_(user_ids)
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
    user_ids = await _company_user_ids(db, current_user)
    
    # Enforce max page_size
    if page_size > 100:
        page_size = 100
    
    discovery_ids = await _user_discovery_ids(db, user_ids)
    
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

    # Batch open port counts for these IPs
    open_port_counts = {}
    if ips:
        asset_ids = list({ip.asset_id for ip in ips})
        ip_addresses = list({ip.ip_address for ip in ips})
        port_count_query = (
            select(AsmPortModel.asset_id, AsmPortModel.ip_address, func.count(AsmPortModel.id).label("port_count"))
            .where(
                AsmPortModel.asset_id.in_(asset_ids),
                AsmPortModel.ip_address.in_(ip_addresses),
            )
            .group_by(AsmPortModel.asset_id, AsmPortModel.ip_address)
        )
        port_count_result = await db.execute(port_count_query)
        open_port_counts = {
            (row.asset_id, row.ip_address): row.port_count for row in port_count_result.all()
        }
    
    items = []
    for ip in ips:
        ip_dict = ip.to_dict()
        ip_dict["open_ports"] = open_port_counts.get((ip.asset_id, ip.ip_address), 0)
        items.append(AsmIPResponse(**ip_dict))
    
    return AsmIPListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# IP Geolocation Map Data
# ---------------------------------------------------
@router.get("/ips/geo-map", response_model=dict)
async def list_ip_geo_map(
    discovery_id: Optional[str] = None,
    max_points: int = 3000,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Geo points for discovered IPs.

    Returns a bounded set of geocoded IP points and a country distribution
    for map and graph views in the UI.
    """
    user_ids = await _company_user_ids(db, current_user)
    discovery_ids = await _user_discovery_ids(db, user_ids)
    if discovery_id:
        if discovery_id not in discovery_ids:
            raise HTTPException(status_code=404, detail="Discovery not found")
        discovery_ids = [discovery_id]

    if not discovery_ids:
        return {"items": [], "countries": [], "total": 0}

    if max_points < 1:
        max_points = 1
    if max_points > 10000:
        max_points = 10000

    base = (
        select(AsmIPModel)
        .where(
            AsmIPModel.asm_discovery_id.in_(discovery_ids),
            AsmIPModel.latitude.is_not(None),
            AsmIPModel.longitude.is_not(None),
        )
        .order_by(AsmIPModel.created_at.desc())
    )

    rows = (await db.execute(base.limit(max_points))).scalars().all()

    items = []
    country_counts: dict[str, int] = {}
    for row in rows:
        country = row.country or "Unknown"
        country_counts[country] = country_counts.get(country, 0) + 1
        items.append(
            {
                "id": row.id,
                "ip_address": row.ip_address,
                "subdomain": row.subdomain,
                "asset_id": row.asset_id,
                "asm_discovery_id": row.asm_discovery_id,
                "country": row.country,
                "country_code": row.country_code,
                "region": row.region,
                "city": row.city,
                "latitude": row.latitude,
                "longitude": row.longitude,
                "asn": row.asn,
                "asn_org": row.asn_org,
                "isp": row.isp,
            }
        )

    countries = [
        {"country": country, "count": count}
        for country, count in sorted(country_counts.items(), key=lambda x: x[1], reverse=True)
    ]
    return {"items": items, "countries": countries, "total": len(items)}


# ---------------------------------------------------
# Ports list
# ---------------------------------------------------
@router.get("/ports", response_model=AsmPortListResponse)
async def list_ports(
    discovery_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmPortModel)
        .join(AsmDiscoveryModel, AsmPortModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmPortModel.asm_discovery_id == discovery_id)
    if ip_address:
        base = base.where(AsmPortModel.ip_address == ip_address)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmPortModel.ip_address.ilike(like),
                AsmPortModel.protocol.ilike(like),
                AsmPortModel.service.ilike(like),
            )
        )

    sort_col = AsmPortModel.created_at
    if sort_by == "ip_address":
        sort_col = AsmPortModel.ip_address
    elif sort_by == "port":
        sort_col = AsmPortModel.port
    elif sort_by == "protocol":
        sort_col = AsmPortModel.protocol
    elif sort_by == "service":
        sort_col = AsmPortModel.service
    elif sort_by == "status":
        sort_col = AsmPortModel.status
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmPortListResponse(
        items=[AsmPortResponse(**r.to_dict()) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Services list
# ---------------------------------------------------
@router.get("/services", response_model=AsmServiceListResponse)
async def list_services(
    discovery_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmServiceModel)
        .join(AsmDiscoveryModel, AsmServiceModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmServiceModel.asm_discovery_id == discovery_id)
    if ip_address:
        base = base.where(AsmServiceModel.ip_address == ip_address)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmServiceModel.ip_address.ilike(like),
                AsmServiceModel.service_name.ilike(like),
                AsmServiceModel.product.ilike(like),
            )
        )

    sort_col = AsmServiceModel.created_at
    if sort_by == "ip_address":
        sort_col = AsmServiceModel.ip_address
    elif sort_by == "port":
        sort_col = AsmServiceModel.port
    elif sort_by == "service_name":
        sort_col = AsmServiceModel.service_name
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmServiceListResponse(
        items=[AsmServiceResponse(**r.to_dict()) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# SSL/TLS certs list
# ---------------------------------------------------
@router.get("/ssl", response_model=AsmSSLCertListResponse)
async def list_ssl_certs(
    discovery_id: Optional[str] = None,
    host: Optional[str] = None,
    subdomain_id: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmSSLCertModel)
        .join(AsmDiscoveryModel, AsmSSLCertModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmSSLCertModel.asm_discovery_id == discovery_id)
    if host:
        base = base.where(AsmSSLCertModel.host == host)
    if subdomain_id:
        base = base.where(AsmSSLCertModel.subdomain_id == subdomain_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmSSLCertModel.host.ilike(like),
                AsmSSLCertModel.certificate_issuer.ilike(like),
                AsmSSLCertModel.certificate_subject.ilike(like),
            )
        )

    sort_col = AsmSSLCertModel.created_at
    if sort_by == "host":
        sort_col = AsmSSLCertModel.host
    elif sort_by == "port":
        sort_col = AsmSSLCertModel.port
    elif sort_by == "valid_until":
        sort_col = AsmSSLCertModel.valid_until
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmSSLCertListResponse(
        items=[AsmSSLCertResponse(**r.to_dict()) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# API endpoints list
# ---------------------------------------------------
@router.get("/api-endpoints", response_model=AsmAPIEndpointListResponse)
async def list_api_endpoints(
    discovery_id: Optional[str] = None,
    subdomain_id: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmAPIEndpointModel)
        .join(AsmDiscoveryModel, AsmAPIEndpointModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmAPIEndpointModel.asm_discovery_id == discovery_id)
    if subdomain_id:
        base = base.where(AsmAPIEndpointModel.subdomain_id == subdomain_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmAPIEndpointModel.url.ilike(like),
                AsmAPIEndpointModel.method.ilike(like),
                AsmAPIEndpointModel.endpoint_type.ilike(like),
            )
        )

    sort_col = AsmAPIEndpointModel.created_at
    if sort_by == "url":
        sort_col = AsmAPIEndpointModel.url
    elif sort_by == "status_code":
        sort_col = AsmAPIEndpointModel.status_code
    elif sort_by == "method":
        sort_col = AsmAPIEndpointModel.method
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmAPIEndpointListResponse(
        items=[AsmAPIEndpointResponse(**r.to_dict()) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Cloud resources list
# ---------------------------------------------------
@router.get("/cloud-resources", response_model=AsmCloudResourceListResponse)
async def list_cloud_resources(
    discovery_id: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmCloudResourceModel)
        .join(AsmDiscoveryModel, AsmCloudResourceModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmCloudResourceModel.asm_discovery_id == discovery_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmCloudResourceModel.service.ilike(like),
                AsmCloudResourceModel.resource_type.ilike(like),
                AsmCloudResourceModel.resource_name.ilike(like),
            )
        )

    sort_col = AsmCloudResourceModel.created_at
    if sort_by == "service":
        sort_col = AsmCloudResourceModel.service
    elif sort_by == "resource_type":
        sort_col = AsmCloudResourceModel.resource_type
    elif sort_by == "resource_name":
        sort_col = AsmCloudResourceModel.resource_name
    elif sort_by == "access_status":
        sort_col = AsmCloudResourceModel.access_status
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmCloudResourceListResponse(
        items=[AsmCloudResourceResponse(**r.to_dict()) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Admin endpoints list
# ---------------------------------------------------
@router.get("/admin-endpoints", response_model=AsmAdminEndpointListResponse)
async def list_admin_endpoints(
    discovery_id: Optional[str] = None,
    subdomain_id: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmAdminEndpointModel)
        .join(AsmDiscoveryModel, AsmAdminEndpointModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmAdminEndpointModel.asm_discovery_id == discovery_id)
    if subdomain_id:
        base = base.where(AsmAdminEndpointModel.subdomain_id == subdomain_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmAdminEndpointModel.url.ilike(like),
                AsmAdminEndpointModel.endpoint_type.ilike(like),
            )
        )

    sort_col = AsmAdminEndpointModel.created_at
    if sort_by == "url":
        sort_col = AsmAdminEndpointModel.url
    elif sort_by == "status_code":
        sort_col = AsmAdminEndpointModel.status_code
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmAdminEndpointListResponse(
        items=[AsmAdminEndpointResponse(**r.to_dict()) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Backup files list
# ---------------------------------------------------
@router.get("/backup-files", response_model=AsmBackupFileListResponse)
async def list_backup_files(
    discovery_id: Optional[str] = None,
    subdomain_id: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmBackupFileModel)
        .join(AsmDiscoveryModel, AsmBackupFileModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmBackupFileModel.asm_discovery_id == discovery_id)
    if subdomain_id:
        base = base.where(AsmBackupFileModel.subdomain_id == subdomain_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmBackupFileModel.file_url.ilike(like),
                AsmBackupFileModel.file_extension.ilike(like),
                AsmBackupFileModel.status.ilike(like),
            )
        )

    sort_col = AsmBackupFileModel.created_at
    if sort_by == "file_url":
        sort_col = AsmBackupFileModel.file_url
    elif sort_by == "file_extension":
        sort_col = AsmBackupFileModel.file_extension
    elif sort_by == "status":
        sort_col = AsmBackupFileModel.status
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmBackupFileListResponse(
        items=[AsmBackupFileResponse(**r.to_dict()) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------
# Change detection list
# ---------------------------------------------------
@router.get("/changes", response_model=AsmChangeListResponse)
async def list_changes(
    discovery_id: Optional[str] = None,
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmChangeModel)
        .join(AsmDiscoveryModel, AsmChangeModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmChangeModel.asm_discovery_id == discovery_id)
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                AsmChangeModel.message.ilike(like),
            )
        )

    sort_col = AsmChangeModel.created_at
    if sort_by == "created_at":
        sort_col = AsmChangeModel.created_at
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return AsmChangeListResponse(
        items=[AsmChangeResponse(**r.to_dict()) for r in rows],
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
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)

    # Ensure user owns the discovery
    disc_q = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        AsmDiscoveryModel.user_id.in_(user_ids)
    )
    disc_res = await db.execute(disc_q)
    disc = disc_res.scalar_one_or_none()
    if not disc:
        raise HTTPException(status_code=404, detail="Discovery not found")

    # Get runs for this discovery
    base_query = select(AsmDiscoveryRunModel).where(
        AsmDiscoveryRunModel.asm_discovery_id == discovery_id
    )
    if q:
        like = f"%{q}%"
        base_query = base_query.where(
            or_(
                AsmDiscoveryRunModel.status.ilike(like),
                AsmDiscoveryRunModel.run_mode.ilike(like),
                AsmDiscoveryRunModel.triggered_by.ilike(like),
            )
        )

    # Total count
    total_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Paginated results
    sort_col = AsmDiscoveryRunModel.started_at
    if sort_by == "completed_at":
        sort_col = AsmDiscoveryRunModel.completed_at
    elif sort_by == "status":
        sort_col = AsmDiscoveryRunModel.status
    elif sort_by == "created_at":
        sort_col = AsmDiscoveryRunModel.created_at
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    paginated_query = (
        base_query
        .order_by(sort_col)
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
            duration_seconds=_calc_duration_seconds(run),
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
    q: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)

    # Get all runs for discoveries owned by the user
    # First, get all discovery IDs owned by the user
    disc_query = select(AsmDiscoveryModel.id).where(AsmDiscoveryModel.user_id.in_(user_ids))
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
    if q:
        like = f"%{q}%"
        base_query = base_query.where(
            or_(
                AsmDiscoveryRunModel.status.ilike(like),
                AsmDiscoveryRunModel.run_mode.ilike(like),
                AsmDiscoveryRunModel.triggered_by.ilike(like),
            )
        )

    # Total count
    total_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Paginated results
    sort_col = AsmDiscoveryRunModel.started_at
    if sort_by == "completed_at":
        sort_col = AsmDiscoveryRunModel.completed_at
    elif sort_by == "status":
        sort_col = AsmDiscoveryRunModel.status
    elif sort_by == "created_at":
        sort_col = AsmDiscoveryRunModel.created_at
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    paginated_query = (
        base_query
        .order_by(sort_col)
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
            duration_seconds=_calc_duration_seconds(run),
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
    user_ids = await _company_user_ids(db, current_user)
    disc_q = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == run.asm_discovery_id,
        AsmDiscoveryModel.user_id.in_(user_ids),
    )
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
        duration_seconds=_calc_duration_seconds(run),
        error_message=run.error_message,
        summary=run.summary,
        created_at=run.created_at.isoformat() if run.created_at else None,
    )


# ---------------------------------------------------
# Repo findings list
# ---------------------------------------------------
@router.get("/repo-findings")
async def list_repo_findings(
    discovery_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmRepoFindingModel)
        .join(AsmDiscoveryModel, AsmRepoFindingModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmRepoFindingModel.asm_discovery_id == discovery_id)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(AsmRepoFindingModel.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [r.to_dict() for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ---------------------------------------------------
# SaaS apps list
# ---------------------------------------------------
@router.get("/saas-apps")
async def list_saas_apps(
    discovery_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmSaasAppModel)
        .join(AsmDiscoveryModel, AsmSaasAppModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmSaasAppModel.asm_discovery_id == discovery_id)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(AsmSaasAppModel.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [r.to_dict() for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ---------------------------------------------------
# User accounts list
# ---------------------------------------------------
@router.get("/user-accounts")
async def list_user_accounts(
    discovery_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_ids = await _company_user_ids(db, current_user)
    if page_size > 100:
        page_size = 100

    base = (
        select(AsmUserAccountModel)
        .join(AsmDiscoveryModel, AsmUserAccountModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(AsmDiscoveryModel.user_id.in_(user_ids))
    )
    if discovery_id:
        base = base.where(AsmUserAccountModel.asm_discovery_id == discovery_id)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(AsmUserAccountModel.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [r.to_dict() for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }

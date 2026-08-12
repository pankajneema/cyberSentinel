# api/asm.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from typing import Optional
from sqlalchemy import select, func, or_, desc
from datetime import datetime

from utils.database import get_db
import os
from notificationservice import events as _NOTIF
from utils.auth import CurrentUser, get_current_user, require_role
from asm.service import enqueue_discovery, list_child_rows, org_filter as _org_filter, user_discovery_ids as _user_discovery_ids
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
from models.tenancy_models import AuditLog
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

# RBAC: owner/admin/analyst may write; reader cannot.
_writer = require_role("owner", "admin", "analyst")


# ---------------------------------------------------
# Helpers
# ---------------------------------------------------
def _calc_duration_seconds(run: AsmDiscoveryRunModel) -> int | None:
    if not run.started_at:
        return None
    if not run.completed_at:
        return None
    return int((run.completed_at - run.started_at).total_seconds())


# ---------------------------------------------------
# ASM Settings
# ---------------------------------------------------
@router.get("/settings")
async def get_asm_settings(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    user_id = current_user.user_id
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
    current_user: CurrentUser = Depends(_writer),
):
    user_id = current_user.user_id
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
async def _emit_scan_event(
    db, current_user: CurrentUser, discovery, event_type: str,
    title: str, body: str = "", severity: str = "info",
) -> None:
    """Best-effort notification emit for a scan lifecycle change. Never raises."""
    try:
        from notificationservice import dispatcher
        org_id = current_user.org_id
        if not org_id:
            return
        await dispatcher.dispatch(
            db, org_id, event_type, title, body=body, severity=severity,
            link=f"/app/asm?discovery={getattr(discovery, 'id', '')}",
            meta={"discovery_id": getattr(discovery, "id", None)},
            owner_user_id=getattr(discovery, "user_id", None) or current_user.user_id,
        )
    except Exception:  # noqa: BLE001 - notifications must not break scan ops
        pass


@router.post("/discoveries", response_model=AsmDiscoveryResponse)
async def create_discovery(
    payload: AsmDiscoveryCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(_writer),
):

    # SSRF / scan-abuse guard: reject manual targets that point at loopback,
    # cloud-metadata (169.254.169.254), or private/reserved ranges — regardless
    # of intensity. The worker applies the authoritative post-DNS-resolution
    # filter to defeat rebinding.
    if payload.target_source == "MANUAL_ENTRY":
        from utils.target_guard import validate_scan_targets
        try:
            validate_scan_targets(payload.manual_targets)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Authorization-to-scan: active (NORMAL/DEEP) discoveries may only target
    # assets whose ownership has been verified, so the platform can't be used to
    # actively scan third-party infrastructure. LIGHT (passive) is always allowed.
    from config.settings import settings as _settings
    from models.asset_models import Asset as _Asset

    if _settings.REQUIRE_SCAN_VERIFICATION and (payload.intensity or "").upper() in ("NORMAL", "DEEP"):
        org_id = current_user.org_id
        if payload.target_source == "MANUAL_ENTRY" or not payload.asset_ids:
            raise HTTPException(
                status_code=403,
                detail="Active (NORMAL/DEEP) scans require a verified-owned asset. Add the "
                       "target as an asset and verify ownership, or use LIGHT (passive) intensity.",
            )
        rows = (
            await db.execute(
                select(_Asset).where(_Asset.id.in_(payload.asset_ids), _Asset.org_id == org_id)
            )
        ).scalars().all()
        found_ids = {a.id for a in rows}
        if any(aid not in found_ids for aid in payload.asset_ids):
            raise HTTPException(status_code=404, detail="One or more target assets not found in your organization.")
        unverified = [a.name for a in rows if not a.ownership_verified]
        if unverified:
            raise HTTPException(
                status_code=403,
                detail=f"Ownership not verified for: {', '.join(unverified)}. Verify via "
                       "POST /api/v1/assets/{id}/verify before running an active scan, or use LIGHT intensity.",
            )

    # We enqueue the first run immediately below, so next_run_at must be the *next*
    # fire AFTER now — otherwise the scheduler would double-fire a recurring job on
    # its next 60s tick. QUICK schedules never recur (next_run_at = None).
    from utils.schedule_math import compute_next_run
    _now = datetime.utcnow()
    _next_run = compute_next_run(payload.schedule_type, payload.schedule_value, _now)

    discovery = AsmDiscoveryModel(
        user_id=current_user.user_id,
        org_id=current_user.org_id,
        name=payload.name,
        asset_type=payload.asset_type,
        target_source=payload.target_source,
        asset_ids=payload.asset_ids,
        manual_targets=payload.manual_targets,
        intensity=payload.intensity,
        schedule_type=payload.schedule_type,
        schedule_value=payload.schedule_value,
        last_run_at=_now,
        next_run_at=_next_run,
        status="PENDING",
    )

    # add() is NOT async
    db.add(discovery)
    await db.commit()
    await db.refresh(discovery)

    discovery_data = discovery.to_dict()

    ok = await enqueue_discovery(discovery, db=db)
    await db.commit()
    if not ok:
        raise HTTPException(
            status_code=500,
            detail="Not able to schedule this discovery",
        )

    await _emit_scan_event(
        db, current_user, discovery, _NOTIF.SCAN_STARTED,
        title=f"Discovery queued: {discovery.name or discovery.id}",
        body=f"{discovery.asset_type} · {discovery.intensity} intensity",
    )
    return discovery_data


# ---------------------------------------------------
# Exposure Signals (defensible CVSS/EPSS/KEV-aware scoring)
# ---------------------------------------------------
@router.get("/exposure")
async def asm_exposure(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Per-IP exposure scored with the defensible model in `scoring/exposure.py`
    (open ports/sensitive services + TLS posture + context), replacing the
    legacy magic-number score. Returns the factor breakdown so the UI can show
    *why* each asset scored what it did.
    """
    discovery_ids = await _user_discovery_ids(db, current_user)
    if not discovery_ids:
        return {"items": [], "total": 0, "truncated": False, "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}}

    # Bound the working set: this endpoint scores every IP in Python (the
    # defensible model needs per-IP ports/services/TLS), so an unbounded load
    # would OOM a large tenant. Cap the rows scored and flag truncation. The full
    # fix (SQL GROUP BY/ORDER BY on a persisted exposure_score) depends on wiring
    # the Python scorer at ingest time — see the reporting/scoring rewrite.
    MAX_EXPOSURE_IPS = int(os.getenv("ASM_MAX_EXPOSURE_IPS", "10000"))
    total_ips = (await db.execute(
        select(func.count()).select_from(AsmIPModel).where(
            AsmIPModel.asm_discovery_id.in_(discovery_ids))
    )).scalar() or 0
    raw_ips = (await db.execute(
        select(AsmIPModel).where(AsmIPModel.asm_discovery_id.in_(discovery_ids))
        .limit(MAX_EXPOSURE_IPS)
    )).scalars().all()
    truncated = total_ips > len(raw_ips)

    # The same physical IP gets one AsmIP row per resolving subdomain (a shared
    # hosting/CDN IP can back hundreds of subdomains), so raw_ips routinely has
    # far more rows than distinct addresses — dedupe before scoring, or the
    # response repeats the same IP (and the frontend's per-IP React key) once
    # per subdomain that happened to resolve to it.
    seen_addrs: set[str] = set()
    ips = []
    for ip in raw_ips:
        if ip.ip_address not in seen_addrs:
            seen_addrs.add(ip.ip_address)
            ips.append(ip)

    if not ips:
        return {"items": [], "total": 0, "truncated": False, "summary": {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}}

    open_ports = (await db.execute(
        select(AsmPortModel).where(
            AsmPortModel.asm_discovery_id.in_(discovery_ids),
            AsmPortModel.status == "open",
        )
    )).scalars().all()
    # AsmPort rows are unique per discovery (not globally), so the same
    # ip:port scanned across multiple historical discovery runs against this
    # org produces one row each time. Dedupe into sets before display, or a
    # port re-confirmed by N scans shows up repeated N times.
    ports_by_ip: dict[str, set[int]] = {}
    services_by_ip: dict[str, set[str]] = {}
    for p in open_ports:
        ports_by_ip.setdefault(p.ip_address, set()).add(p.port)
        if p.service:
            services_by_ip.setdefault(p.ip_address, set()).add(p.service)

    certs = (await db.execute(
        select(AsmSSLCertModel).where(AsmSSLCertModel.asm_discovery_id.in_(discovery_ids))
    )).scalars().all()
    # Same cross-discovery duplication as ports/services above: dedupe with a
    # set, or an "expired" cert re-confirmed by N historical scans would add
    # N * TLS_ISSUE_POINTS["expired"] to the score instead of counting once.
    tls_by_host: dict[str, set[str]] = {}
    now = datetime.utcnow()
    for c in certs:
        if c.valid_until and c.valid_until < now:
            tls_by_host.setdefault(c.host, set()).add("expired")

    summary = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    items = []
    for ip in ips:
        addr = ip.ip_address
        sc = score_exposure(AssetSignals(
            open_ports=sorted(ports_by_ip.get(addr, set())),
            services=sorted(services_by_ip.get(addr, set())),
            is_public=True,                 # externally-discovered = internet-facing
            tls_issues=list(tls_by_host.get(addr, set())),
            asset_criticality="normal",
        ))
        summary[sc.severity] = summary.get(sc.severity, 0) + 1
        items.append({
            "ip_address": addr,
            "country": ip.country,
            "country_code": ip.country_code,
            "asn": ip.asn,
            "asn_org": ip.asn_org,
            "open_ports": sorted(ports_by_ip.get(addr, set())),
            "score": sc.score,
            "severity": sc.severity,
            "factors": sc.to_dict()["factors"],
        })

    items.sort(key=lambda r: r["score"], reverse=True)
    return {"items": items[:limit], "total": len(items), "truncated": truncated, "summary": summary}


# ---------------------------------------------------
# List Discoveries
# ---------------------------------------------------
@router.get("/discoveries", response_model=AsmDiscoveryListResponse)
async def list_discoveries(
    page: int = 1,
    page_size: int = 20,
    q: Optional[str] = None,
    status: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    base_query = select(AsmDiscoveryModel).where(
        _org_filter(AsmDiscoveryModel, current_user)
    )
    if status:
        base_query = base_query.where(AsmDiscoveryModel.status == status)
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

    # Status breakdown across the whole filtered set — the UI's summary cards
    # (Active/Completed/Failed) and status tabs need org-wide counts, not just
    # whatever fell on this page. Re-applies the same filters as `base_query`
    # (can't GROUP BY off its subquery directly — the ORM class's columns
    # don't bind to a derived subquery's columns).
    status_counts_query = select(AsmDiscoveryModel.status, func.count()).where(
        _org_filter(AsmDiscoveryModel, current_user)
    )
    if q:
        like = f"%{q}%"
        status_counts_query = status_counts_query.where(
            or_(
                AsmDiscoveryModel.name.ilike(like),
                AsmDiscoveryModel.status.ilike(like),
                AsmDiscoveryModel.asset_type.ilike(like),
            )
        )
    status_counts_result = await db.execute(
        status_counts_query.group_by(AsmDiscoveryModel.status)
    )
    status_counts = {row[0]: row[1] for row in status_counts_result.all()}

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
        status_counts=status_counts,
    )


# ---------------------------------------------------
# Get Discovery by ID
# ---------------------------------------------------
@router.get("/discoveries/{discovery_id}", response_model=AsmDiscoveryResponse)
async def get_discovery(
    discovery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        _org_filter(AsmDiscoveryModel, current_user),
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
    current_user: CurrentUser = Depends(_writer),
):
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        _org_filter(AsmDiscoveryModel, current_user),
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
    current_user: CurrentUser = Depends(_writer),
):
    """Manually (re-)queue an existing discovery for immediate execution.

    Mirrors the create-time enqueue: marks the discovery PENDING with an
    immediate next_run_at and publishes the same job message the worker
    consumes. Scoped to the caller's org.
    """
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        _org_filter(AsmDiscoveryModel, current_user),
    )
    result = await db.execute(query)
    discovery = result.scalar_one_or_none()

    if not discovery:
        raise HTTPException(status_code=404, detail="Discovery not found")

    # Run now, and set next_run_at to the *next* scheduled fire (not now) so a
    # recurring discovery isn't immediately re-fired by the scheduler tick.
    from utils.schedule_math import compute_next_run
    _now = datetime.utcnow()
    discovery.status = "PENDING"
    discovery.last_run_at = _now
    discovery.next_run_at = compute_next_run(discovery.schedule_type, discovery.schedule_value, _now)
    await db.commit()
    await db.refresh(discovery)

    ok = await enqueue_discovery(discovery, db=db)
    await db.commit()
    if not ok:
        raise HTTPException(status_code=500, detail="Not able to schedule this discovery")

    await _emit_scan_event(
        db, current_user, discovery, _NOTIF.SCAN_STARTED,
        title=f"Discovery started: {discovery.name or discovery.id}",
        body=f"{discovery.asset_type} · {discovery.intensity} intensity",
    )
    return discovery.to_dict()


# ---------------------------------------------------
# Pause / Resume recurring schedule
# ---------------------------------------------------
async def _get_owned_discovery(discovery_id: str, db: AsyncSession, current_user: CurrentUser):
    result = await db.execute(
        select(AsmDiscoveryModel).where(
            AsmDiscoveryModel.id == discovery_id,
            _org_filter(AsmDiscoveryModel, current_user),
        )
    )
    discovery = result.scalar_one_or_none()
    if not discovery:
        raise HTTPException(status_code=404, detail="Discovery not found")
    return discovery


@router.post("/discoveries/{discovery_id}/pause", response_model=AsmDiscoveryResponse)
async def pause_discovery(
    discovery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(_writer),
):
    """Pause a recurring schedule. The scheduler skips PAUSED discoveries; an
    in-flight run (RUNNING) is left to finish — use /stop to cancel that."""
    discovery = await _get_owned_discovery(discovery_id, db, current_user)
    if discovery.status == "RUNNING":
        raise HTTPException(status_code=409, detail="Discovery is currently running; stop it first.")
    discovery.status = "PAUSED"
    discovery.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(discovery)
    await _emit_scan_event(
        db, current_user, discovery, _NOTIF.SCAN_PAUSED,
        title=f"Schedule paused: {discovery.name or discovery.id}",
    )
    return discovery.to_dict()


@router.post("/discoveries/{discovery_id}/resume", response_model=AsmDiscoveryResponse)
async def resume_discovery(
    discovery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(_writer),
):
    """Resume a paused schedule and recompute the next fire time from now."""
    from utils.schedule_math import compute_next_run
    discovery = await _get_owned_discovery(discovery_id, db, current_user)
    _now = datetime.utcnow()
    discovery.status = "PENDING"
    discovery.next_run_at = compute_next_run(discovery.schedule_type, discovery.schedule_value, _now)
    discovery.updated_at = _now
    await db.commit()
    await db.refresh(discovery)
    await _emit_scan_event(
        db, current_user, discovery, _NOTIF.SCAN_RESUMED,
        title=f"Schedule resumed: {discovery.name or discovery.id}",
    )
    return discovery.to_dict()


@router.post("/discoveries/{discovery_id}/stop", response_model=AsmDiscoveryResponse)
async def stop_discovery(
    discovery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(_writer),
):
    """Stop an in-flight run. Flips status so the scheduler won't re-enqueue and the
    UI reflects a cancelled run. (Cooperative worker-side cancellation is Phase A.)"""
    discovery = await _get_owned_discovery(discovery_id, db, current_user)
    discovery.status = "FAILED"
    discovery.next_run_at = None
    discovery.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(discovery)
    await _emit_scan_event(
        db, current_user, discovery, _NOTIF.SCAN_STOPPED,
        title=f"Discovery stopped: {discovery.name or discovery.id}",
        severity="medium",
    )
    return discovery.to_dict()


# ---------------------------------------------------
# Delete Discovery
# ---------------------------------------------------
@router.delete("/discoveries/{discovery_id}", response_model=AsmDiscoveryResponse)
async def delete_discovery(
    discovery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(_writer),
):
    query = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        _org_filter(AsmDiscoveryModel, current_user),
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
    current_user: CurrentUser = Depends(get_current_user),
):

    # Total discoveries
    total_query = select(func.count()).select_from(
        select(AsmDiscoveryModel)
        .where(_org_filter(AsmDiscoveryModel, current_user))
        .subquery()
    )
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Active discoveries
    active_query = select(func.count()).select_from(
        select(AsmDiscoveryModel)
        .where(
            _org_filter(AsmDiscoveryModel, current_user),
            AsmDiscoveryModel.status == "RUNNING",
        )
        .subquery()
    )
    active_result = await db.execute(active_query)
    active = active_result.scalar() or 0

    # Last discovery run
    last_run_query = (
        select(AsmDiscoveryRunModel)
        .where(_org_filter(AsmDiscoveryRunModel, current_user))
        .order_by(AsmDiscoveryRunModel.started_at.desc())
        .limit(1)
    )
    last_run_result = await db.execute(last_run_query)
    last_run = last_run_result.scalar_one_or_none()

    # Attack Surface Score = real average of asset exposure scores (0–100), the same
    # figure the /dashboard/overview endpoint reports. No placeholder: if no assets
    # are scored yet it is 0 (auto-scoring populates it after a scan).
    avg_q = select(func.avg(AssetModel.risk_score)).where(_org_filter(AssetModel, current_user))
    avg_score = (await db.execute(avg_q)).scalar() or 0
    attack_surface_score = int(avg_score)

    return AsmDashboardResponse(
        attack_surface_score=attack_surface_score,
        total_discoveries=total,
        active_discoveries=active,
        last_discovery_run=(last_run.started_at.isoformat() + "Z") if last_run and last_run.started_at else None,
    )


# ---------------------------------------------------
# Dashboard Overview (more metrics)
# ---------------------------------------------------
@router.get("/dashboard/overview", response_model=AsmOverviewResponse)
async def asm_overview(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):

    # total discoveries
    total_query = select(func.count()).select_from(
        select(AsmDiscoveryModel).where(_org_filter(AsmDiscoveryModel, current_user)).subquery()
    )
    total = (await db.execute(total_query)).scalar() or 0

    # active discoveries
    active_query = select(func.count()).select_from(
        select(AsmDiscoveryModel).where(_org_filter(AsmDiscoveryModel, current_user), AsmDiscoveryModel.status == "RUNNING").subquery()
    )
    active = (await db.execute(active_query)).scalar() or 0

    # total subdomains (join with discoveries to ensure user scoping)
    subdomain_query = select(func.count()).select_from(
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(_org_filter(AsmDiscoveryModel, current_user))
        .subquery()
    )
    total_subdomains = (await db.execute(subdomain_query)).scalar() or 0

    # Distinct IPs discovered (join with discoveries to ensure user scoping).
    # The same physical IP gets one AsmIP row per resolving subdomain (and
    # again per re-scan), so a plain row count wildly overstates real hosts —
    # count distinct addresses instead.
    ip_query = (
        select(func.count(func.distinct(AsmIPModel.ip_address)))
        .select_from(AsmIPModel)
        .join(AsmDiscoveryModel, AsmIPModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(_org_filter(AsmDiscoveryModel, current_user))
    )
    total_ips_discovered = (await db.execute(ip_query)).scalar() or 0

    # last discovery run
    last_run_query = (
        select(AsmDiscoveryRunModel)
        .where(_org_filter(AsmDiscoveryRunModel, current_user))
        .order_by(AsmDiscoveryRunModel.started_at.desc())
        .limit(1)
    )
    last_run = (await db.execute(last_run_query)).scalar_one_or_none()
    

    # Asset counts
    total_assets_q = select(func.count()).select_from(
        select(AssetModel).where(_org_filter(AssetModel, current_user)).subquery()
    )
    total_assets = (await db.execute(total_assets_q)).scalar() or 0

    total_domains_q = select(func.count()).select_from(
        select(AssetModel).where(_org_filter(AssetModel, current_user), AssetModel.type == 'domain').subquery()
    )
    total_domains = (await db.execute(total_domains_q)).scalar() or 0

    total_cloud_q = select(func.count()).select_from(
        select(AssetModel).where(_org_filter(AssetModel, current_user), AssetModel.type == 'cloud').subquery()
    )
    total_cloud = (await db.execute(total_cloud_q)).scalar() or 0

    total_ips_q = select(func.count()).select_from(
        select(AssetModel).where(_org_filter(AssetModel, current_user), AssetModel.type == 'ip').subquery()
    )
    total_ips = (await db.execute(total_ips_q)).scalar() or 0

    # Real count of discovered services (fingerprinted open ports) for the org,
    # scoped through the discovery join like the other ASM child tables.
    total_services_q = (
        select(func.count())
        .select_from(AsmServiceModel)
        .join(AsmDiscoveryModel, AsmServiceModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(_org_filter(AsmDiscoveryModel, current_user))
    )
    total_services = (await db.execute(total_services_q)).scalar() or 0

    # Load ASM settings for thresholds — the CALLER's own settings only.
    # AsmSettings is per-user (unique user_id); scoping by the whole member set
    # could surface another member's thresholds.
    settings_query = (
        select(AsmSettingsModel)
        .where(AsmSettingsModel.user_id == current_user.user_id)
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
            _org_filter(AssetModel, current_user),
            AssetModel.risk_score >= high_threshold
        ).subquery()
    )
    high_exposure_count = (await db.execute(high_exposure_q)).scalar() or 0
    
    medium_exposure_q = select(func.count()).select_from(
        select(AssetModel).where(
            _org_filter(AssetModel, current_user),
            AssetModel.risk_score.between(medium_threshold, high_threshold - 1)
        ).subquery()
    )
    medium_exposure_count = (await db.execute(medium_exposure_q)).scalar() or 0

    # Low = SCORED assets below the medium threshold. Unscanned assets
    # (risk_score IS NULL) are NOT low-exposure — they are unknown, and must be
    # reported separately rather than padded into "low" (which reads as safe).
    low_exposure_q = select(func.count()).select_from(
        select(AssetModel).where(
            _org_filter(AssetModel, current_user),
            AssetModel.risk_score.isnot(None),
            AssetModel.risk_score < medium_threshold,
        ).subquery()
    )
    low_exposure_count = (await db.execute(low_exposure_q)).scalar() or 0

    unscanned_q = select(func.count()).select_from(
        select(AssetModel).where(
            _org_filter(AssetModel, current_user),
            AssetModel.risk_score.is_(None),
        ).subquery()
    )
    unscanned_count = (await db.execute(unscanned_q)).scalar() or 0

    # Attack Surface Index: average exposure score (0-100)
    avg_q = select(func.avg(AssetModel.risk_score)).where(_org_filter(AssetModel, current_user))
    avg_res = await db.execute(avg_q)
    avg_score = avg_res.scalar() or 0
    attack_surface_index = int(avg_score)

    # Exposure summary
    public_assets_q = select(func.count()).select_from(
        select(AssetModel).where(_org_filter(AssetModel, current_user), AssetModel.exposure == 'public').subquery()
    )
    public_assets = (await db.execute(public_assets_q)).scalar() or 0
    
    # Internet-facing services = real count of open ports discovered by ASM (ASM scans
    # external targets, so a discovered open port is an internet-facing service).
    ifs_q = (
        select(func.count())
        .select_from(AsmPortModel)
        .join(AsmDiscoveryModel, AsmPortModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(_org_filter(AsmDiscoveryModel, current_user), AsmPortModel.status == "open")
    )
    internet_facing_services = (await db.execute(ifs_q)).scalar() or 0

    # Unknown ownership: assets without clear ownership tags
    unknown_assets_q = select(func.count()).select_from(
        select(AssetModel).where(_org_filter(AssetModel, current_user), AssetModel.tags == []).subquery()
    )
    unknown_assets = (await db.execute(unknown_assets_q)).scalar() or 0

    # Top exposed assets by exposure_score (mapped from risk_score)
    top_q = select(AssetModel).where(_org_filter(AssetModel, current_user)).order_by(AssetModel.risk_score.desc()).limit(5)
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
        {"label": "unscanned", "count": int(unscanned_count)},
    ]

    # Recent activity — real org events from the audit trail (last ~10).
    recent_activity = []
    org_id = current_user.org_id
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
                "time": (log.created_at.isoformat() + "Z") if log.created_at else None,
                "type": (log.action or "").split(".")[0] or log.action,
            }
            for log in recent_logs
        ]

    return AsmOverviewResponse(
        attack_surface_index=attack_surface_index,
        total_discoveries=total,
        active_discoveries=active,
        last_discovery_run=(last_run.started_at.isoformat() + "Z") if last_run and last_run.started_at else None,
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
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List subdomains with pagination.
    
    Performance: Uses pagination to handle large datasets (250+ subdomains).
    Max page_size is 100 to prevent UI crashes.
    """
    
    # Enforce max page_size for performance
    if page_size > 100:
        page_size = 100

    # Base query: join to ensure user scoping and include asset info
    base = (
        select(AsmSubdomainModel, AssetModel.name.label("asset_name"), AssetModel.type.label("asset_type"))
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .outerjoin(AssetModel, AsmSubdomainModel.asset_id == AssetModel.id)
        .where(_org_filter(AsmDiscoveryModel, current_user))
    )

    if discovery_id:
        base = base.where(AsmSubdomainModel.asm_discovery_id == discovery_id)

    # Optimized count query (separate, faster)
    total_base = (
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(_org_filter(AsmDiscoveryModel, current_user))
    )
    if discovery_id:
        total_base = total_base.where(AsmSubdomainModel.asm_discovery_id == discovery_id)
    
    total_q = select(func.count()).select_from(total_base.subquery())
    total = (await db.execute(total_q)).scalar() or 0

    active_q = select(func.count()).select_from(
        total_base.where(AsmSubdomainModel.status == "active").subquery()
    )
    active_count = (await db.execute(active_q)).scalar() or 0

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
        active_count=active_count,
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
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List IPs for a specific subdomain.
    
    HIERARCHY: Domain → Subdomain → IP
    This endpoint shows IPs that belong to a subdomain.
    IPs are derived from DNS resolution of the subdomain.
    
    Risk flows bottom-up: IP exposure → Subdomain exposure → Domain exposure
    """
    
    # Enforce max page_size
    if page_size > 100:
        page_size = 100
    
    # Verify subdomain exists and user has access
    subdomain_query = (
        select(AsmSubdomainModel)
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .where(
            AsmSubdomainModel.id == subdomain_id,
            _org_filter(AsmDiscoveryModel, current_user)
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
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get subdomain detail with IP count and basic IP info.
    
    Returns subdomain info with:
    - IP count (for UI display)
    - First few IPs (preview)
    """
    
    # Get subdomain with user verification
    subdomain_query = (
        select(AsmSubdomainModel, AssetModel.name.label("asset_name"), AssetModel.type.label("asset_type"))
        .join(AsmDiscoveryModel, AsmSubdomainModel.asm_discovery_id == AsmDiscoveryModel.id)
        .outerjoin(AssetModel, AsmSubdomainModel.asset_id == AssetModel.id)
        .where(
            AsmSubdomainModel.id == subdomain_id,
            _org_filter(AsmDiscoveryModel, current_user)
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
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all IPs discovered by the user.

    Shows all distinct IPs across all discoveries, with pagination.
    """

    # Enforce max page_size
    if page_size > 100:
        page_size = 100

    discovery_ids = await _user_discovery_ids(db, current_user)

    if not discovery_ids:
        return AsmIPListResponse(
            items=[],
            total=0,
            page=page,
            page_size=page_size,
        )

    # The same physical IP gets one AsmIP row per resolving subdomain (and
    # again per re-scan, since AsmIP is unique per discovery, not globally) —
    # a shared hosting/CDN address can rack up hundreds of near-identical
    # rows. DISTINCT ON collapses that to one row per address (the most
    # recently created) before pagination, so "Total IPs" and the listing
    # reflect real distinct hosts instead of raw resolution-history rows.
    dedup_subq = (
        select(AsmIPModel)
        .where(AsmIPModel.asm_discovery_id.in_(discovery_ids))
        .distinct(AsmIPModel.ip_address)
        .order_by(AsmIPModel.ip_address, AsmIPModel.created_at.desc())
    ).subquery()
    DedupIP = aliased(AsmIPModel, dedup_subq)

    # Total count (of distinct IPs)
    total_query = select(func.count()).select_from(dedup_subq)
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    # Paginated results
    paginated_query = (
        select(DedupIP)
        .order_by(desc(dedup_subq.c.created_at))
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
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Geo points for discovered IPs.

    Returns a bounded set of geocoded IP points and a country distribution
    for map and graph views in the UI.
    """
    discovery_ids = await _user_discovery_ids(db, current_user)
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

    raw_rows = (await db.execute(base.limit(max_points))).scalars().all()

    # Same cross-subdomain duplication as /exposure: one AsmIP row per
    # resolving subdomain means the same geocoded address can appear many
    # times over. Dedupe by address, or a single IP renders as a stack of
    # identical overlapping markers on the map.
    seen_addrs: set[str] = set()
    rows = []
    for row in raw_rows:
        if row.ip_address not in seen_addrs:
            seen_addrs.add(row.ip_address)
            rows.append(row)

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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmPortModel,
        page=page, page_size=page_size,
        filters={AsmPortModel.asm_discovery_id: discovery_id,
                 AsmPortModel.ip_address: ip_address},
        q=q, search_cols=(AsmPortModel.ip_address, AsmPortModel.protocol, AsmPortModel.service),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"ip_address": AsmPortModel.ip_address, "port": AsmPortModel.port,
                   "protocol": AsmPortModel.protocol, "service": AsmPortModel.service,
                   "status": AsmPortModel.status},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmServiceModel,
        page=page, page_size=page_size,
        filters={AsmServiceModel.asm_discovery_id: discovery_id,
                 AsmServiceModel.ip_address: ip_address},
        q=q, search_cols=(AsmServiceModel.ip_address, AsmServiceModel.service_name,
                          AsmServiceModel.product),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"ip_address": AsmServiceModel.ip_address, "port": AsmServiceModel.port,
                   "service_name": AsmServiceModel.service_name},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmSSLCertModel,
        page=page, page_size=page_size,
        filters={AsmSSLCertModel.asm_discovery_id: discovery_id,
                 AsmSSLCertModel.host: host,
                 AsmSSLCertModel.subdomain_id: subdomain_id},
        q=q, search_cols=(AsmSSLCertModel.host, AsmSSLCertModel.certificate_issuer,
                          AsmSSLCertModel.certificate_subject),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"host": AsmSSLCertModel.host, "port": AsmSSLCertModel.port,
                   "valid_until": AsmSSLCertModel.valid_until},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmAPIEndpointModel,
        page=page, page_size=page_size,
        filters={AsmAPIEndpointModel.asm_discovery_id: discovery_id,
                 AsmAPIEndpointModel.subdomain_id: subdomain_id},
        q=q, search_cols=(AsmAPIEndpointModel.url, AsmAPIEndpointModel.method,
                          AsmAPIEndpointModel.endpoint_type),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"url": AsmAPIEndpointModel.url, "status_code": AsmAPIEndpointModel.status_code,
                   "method": AsmAPIEndpointModel.method},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmCloudResourceModel,
        page=page, page_size=page_size,
        filters={AsmCloudResourceModel.asm_discovery_id: discovery_id},
        q=q, search_cols=(AsmCloudResourceModel.service, AsmCloudResourceModel.resource_type,
                          AsmCloudResourceModel.resource_name),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"service": AsmCloudResourceModel.service,
                   "resource_type": AsmCloudResourceModel.resource_type,
                   "resource_name": AsmCloudResourceModel.resource_name,
                   "access_status": AsmCloudResourceModel.access_status},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmAdminEndpointModel,
        page=page, page_size=page_size,
        filters={AsmAdminEndpointModel.asm_discovery_id: discovery_id,
                 AsmAdminEndpointModel.subdomain_id: subdomain_id},
        q=q, search_cols=(AsmAdminEndpointModel.url, AsmAdminEndpointModel.endpoint_type),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"url": AsmAdminEndpointModel.url,
                   "status_code": AsmAdminEndpointModel.status_code},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmBackupFileModel,
        page=page, page_size=page_size,
        filters={AsmBackupFileModel.asm_discovery_id: discovery_id,
                 AsmBackupFileModel.subdomain_id: subdomain_id},
        q=q, search_cols=(AsmBackupFileModel.file_url, AsmBackupFileModel.file_extension,
                          AsmBackupFileModel.status),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"file_url": AsmBackupFileModel.file_url,
                   "file_extension": AsmBackupFileModel.file_extension,
                   "status": AsmBackupFileModel.status},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmChangeModel,
        page=page, page_size=page_size,
        filters={AsmChangeModel.asm_discovery_id: discovery_id},
        q=q, search_cols=(AsmChangeModel.message,),
        sort_by=sort_by, sort_dir=sort_dir,
        sort_cols={"created_at": AsmChangeModel.created_at},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):

    # Ensure user owns the discovery
    disc_q = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == discovery_id,
        _org_filter(AsmDiscoveryModel, current_user)
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
            started_at=(run.started_at.isoformat() + "Z") if run.started_at else None,
            completed_at=(run.completed_at.isoformat() + "Z") if run.completed_at else None,
            duration_seconds=_calc_duration_seconds(run),
            error_message=run.error_message,
            summary=run.summary,
            created_at=(run.created_at.isoformat() + "Z") if run.created_at else None,
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
    current_user: CurrentUser = Depends(get_current_user),
):

    # Get all runs for discoveries owned by the user
    # First, get all discovery IDs owned by the user
    disc_query = select(AsmDiscoveryModel.id).where(_org_filter(AsmDiscoveryModel, current_user))
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

    # Status breakdown across the whole filtered set (org-wide, not just this
    # page) — the Reports tab's "Completed" / "Success Rate" cards need this,
    # same reasoning as AsmDiscoveryListResponse.status_counts.
    status_counts_query = select(AsmDiscoveryRunModel.status, func.count()).where(
        AsmDiscoveryRunModel.asm_discovery_id.in_(discovery_ids)
    )
    if q:
        like = f"%{q}%"
        status_counts_query = status_counts_query.where(
            or_(
                AsmDiscoveryRunModel.status.ilike(like),
                AsmDiscoveryRunModel.run_mode.ilike(like),
                AsmDiscoveryRunModel.triggered_by.ilike(like),
            )
        )
    status_counts_result = await db.execute(
        status_counts_query.group_by(AsmDiscoveryRunModel.status)
    )
    status_counts = {row[0]: row[1] for row in status_counts_result.all()}

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
            started_at=(run.started_at.isoformat() + "Z") if run.started_at else None,
            completed_at=(run.completed_at.isoformat() + "Z") if run.completed_at else None,
            duration_seconds=_calc_duration_seconds(run),
            error_message=run.error_message,
            summary=run.summary,
            created_at=(run.created_at.isoformat() + "Z") if run.created_at else None,
        ) for run in runs],
        total=total,
        page=page,
        page_size=page_size,
        status_counts=status_counts,
    )


# ---------------------------------------------------
# Discovery Run detail (for "complete view")
# ---------------------------------------------------
@router.get("/runs/{run_id}", response_model=AsmDiscoveryRunResponse)
async def get_run_detail(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = select(AsmDiscoveryRunModel).where(AsmDiscoveryRunModel.id == run_id)
    result = await db.execute(query)
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Ensure user owns the discovery
    disc_q = select(AsmDiscoveryModel).where(
        AsmDiscoveryModel.id == run.asm_discovery_id,
        _org_filter(AsmDiscoveryModel, current_user),
    )
    disc_res = await db.execute(disc_q)
    disc = disc_res.scalar_one_or_none()
    if not disc:
        raise HTTPException(status_code=403, detail="Forbidden")

    return AsmDiscoveryRunResponse(
        id=run.id,
        asm_discovery_id=run.asm_discovery_id,
        user_id=run.user_id,
        triggered_by=run.triggered_by,
        run_mode=run.run_mode,
        status=run.status,
        started_at=(run.started_at.isoformat() + "Z") if run.started_at else None,
        completed_at=(run.completed_at.isoformat() + "Z") if run.completed_at else None,
        duration_seconds=_calc_duration_seconds(run),
        error_message=run.error_message,
        summary=run.summary,
        created_at=(run.created_at.isoformat() + "Z") if run.created_at else None,
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmRepoFindingModel,
        page=page, page_size=page_size,
        filters={AsmRepoFindingModel.asm_discovery_id: discovery_id},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmSaasAppModel,
        page=page, page_size=page_size,
        filters={AsmSaasAppModel.asm_discovery_id: discovery_id},
    )
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
    current_user: CurrentUser = Depends(get_current_user),
):
    if page_size > 100:
        page_size = 100
    rows, total = await list_child_rows(
        db, current_user, AsmUserAccountModel,
        page=page, page_size=page_size,
        filters={AsmUserAccountModel.asm_discovery_id: discovery_id},
    )
    return {
        "items": [r.to_dict() for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }

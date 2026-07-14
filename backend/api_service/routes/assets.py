"""
Assets route — migrated to Supabase identity + direct org_id tenancy (Phase 3).

This is the reference pattern for migrating the remaining routes off the legacy
`_company_user_ids` rebuild:
  - authenticate via `get_current_user` (verified Supabase claims -> CurrentUser
    with org_id + role)
  - filter every query by `org_id` directly (real tenant isolation)
  - gate writes with `require_role(...)` (server-side RBAC)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from datetime import datetime

from utils.database import get_db
from utils.supabase_auth import CurrentUser, get_current_user, require_role
from utils.tenancy import require_org
from models.asset_models import Asset as AssetModel
from scoring import score_exposure
from scoring.asset_signals import _gather_asset_signals

from schemas.asset_schema import (
    AssetCreateRequest,
    AssetUpdateRequest,
    AssetResponse,
    AssetListResponse,
    AssetImportRequest,
    AssetImportResult,
    AssetRescoreResult,
)

import ipaddress
import re

router = APIRouter(prefix="/api/v1/assets", tags=["Assets"])

# Roles allowed to mutate assets.
_writer = require_role("owner", "admin", "analyst")

_DOMAIN_RE = re.compile(r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})+$")


def _valid_asset(name: str, atype: str) -> bool:
    """Light validation per asset type so junk rows are skipped on import."""
    name = (name or "").strip()
    if not name:
        return False
    if atype == "domain":
        return bool(_DOMAIN_RE.match(name.rstrip(".")))
    if atype == "ip":
        try:
            ipaddress.ip_network(name, strict=False)  # accepts IP or CIDR
            return True
        except ValueError:
            return False
    # cloud / repo / saas / user — free-form identifiers
    return len(name) <= 255


@router.get("", response_model=AssetListResponse)
async def list_assets(
    q: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    exposure: Optional[str] = Query(None),
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    query = select(AssetModel).filter(AssetModel.org_id == org_id)

    if q:
        query = query.filter(AssetModel.name.ilike(f"%{q}%"))
    if type:
        query = query.filter(AssetModel.type == type)
    if exposure:
        query = query.filter(AssetModel.exposure == exposure)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()

    query = (
        query.order_by(AssetModel.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    assets = (await db.execute(query)).scalars().all()

    return AssetListResponse(
        items=[a.to_dict() for a in assets],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/import", response_model=AssetImportResult)
async def import_assets(
    payload: AssetImportRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    """Bulk-create assets from parsed CSV rows. Validates per type, dedups by name."""
    org_id = require_org(user.org_id)

    # Existing names in this org (case-insensitive dedup).
    existing_rows = (
        await db.execute(select(AssetModel.name).filter(AssetModel.org_id == org_id))
    ).all()
    seen = {r[0].lower() for r in existing_rows}

    created = skipped = 0
    errors: list[str] = []

    for idx, row in enumerate(payload.assets, start=1):
        name = (row.name or "").strip()
        if not name:
            skipped += 1
            continue
        if name.lower() in seen:
            skipped += 1
            continue
        if not _valid_asset(name, row.type):
            errors.append(f"Row {idx}: '{name}' is not a valid {row.type}")
            skipped += 1
            continue
        db.add(AssetModel(
            org_id=org_id,
            user_id=user.user_id,
            name=name,
            type=row.type,
            exposure=row.exposure,
            tags=row.tags or [],
            description=row.description,
            status="active",
            risk_score=None,        # unscanned until a discovery / rescore runs
        ))
        seen.add(name.lower())
        created += 1

    await db.commit()
    return AssetImportResult(created=created, skipped=skipped, errors=errors[:50])


@router.post("", response_model=AssetResponse)
async def create_asset(
    payload: AssetCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    org_id = require_org(user.org_id)
    asset = AssetModel(
        org_id=org_id,
        user_id=user.user_id,
        name=payload.name,
        type=payload.type,
        exposure=payload.exposure,
        criticality=payload.criticality,
        tags=payload.tags or [],
        description=payload.description,
        status="active",
        risk_score=None,        # unscanned until a discovery / rescore runs
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset.to_dict()


# ---------------------------------------------------------------------------
# Real exposure scoring — pulls ASM scan data for this asset and runs the
# defensible scoring engine (scoring/exposure.py). No fake/random numbers:
# if there is no scan data for the asset, it stays "Unscanned".
# Signal gathering lives in scoring/asset_signals.py (shared with the
# scheduler's auto-score pass).
# ---------------------------------------------------------------------------
@router.post("/{asset_id}/rescore", response_model=AssetRescoreResult)
async def rescore_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    """Recompute an asset's exposure score from its real ASM scan data."""
    asset = await _get_owned_asset(db, asset_id, require_org(user.org_id))
    signals, matched_ips = await _gather_asset_signals(db, asset.org_id, asset)

    if signals is None:
        return AssetRescoreResult(
            scored=False,
            risk_score=asset.risk_score,
            matched_ips=[],
            message="No scan data for this asset yet. Run an ASM discovery against it first.",
        )

    result = score_exposure(signals)
    asset.risk_score = result.score
    asset.last_scored_at = datetime.utcnow()
    await db.commit()
    await db.refresh(asset)

    return AssetRescoreResult(
        scored=True,
        risk_score=result.score,
        severity=result.severity,
        factors=[
            {"name": f.name, "points": round(f.points, 1), "detail": f.detail}
            for f in result.factors
        ],
        matched_ips=matched_ips,
    )


async def _get_owned_asset(db: AsyncSession, asset_id: str, org_id: str) -> AssetModel:
    asset = (
        await db.execute(
            select(AssetModel).filter(
                AssetModel.id == asset_id,
                AssetModel.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    asset = await _get_owned_asset(db, asset_id, require_org(user.org_id))
    return asset.to_dict()


@router.patch("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: str,
    payload: AssetUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    asset = await _get_owned_asset(db, asset_id, require_org(user.org_id))
    for key, value in payload.dict(exclude_unset=True).items():
        setattr(asset, key, value)
    await db.commit()
    await db.refresh(asset)
    return asset.to_dict()


@router.delete("/{asset_id}")
async def delete_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    asset = await _get_owned_asset(db, asset_id, require_org(user.org_id))
    await db.delete(asset)
    await db.commit()
    return {"message": "Asset deleted successfully"}


# ---------------------------------------------------------------------------
# Authorization-to-scan: ownership verification
# ---------------------------------------------------------------------------
# Active discoveries (NORMAL/DEEP) require proven ownership of the target so the
# platform cannot be used to actively scan third-party infrastructure.

from utils.ownership_verify import VERIFY_PREFIX as _VERIFY_PREFIX, domain_txt_matches  # noqa: E402


@router.post("/{asset_id}/verification-token")
async def get_verification_token(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    """Issue (or return) the ownership-verification token + instructions."""
    import secrets

    asset = await _get_owned_asset(db, asset_id, require_org(user.org_id))
    if not asset.verification_token:
        asset.verification_token = secrets.token_urlsafe(24)
        await db.commit()
        await db.refresh(asset)

    txt_value = f"{_VERIFY_PREFIX}={asset.verification_token}"
    return {
        "asset_id": asset.id,
        "name": asset.name,
        "type": asset.type,
        "ownership_verified": asset.ownership_verified,
        "token": asset.verification_token,
        "dns_txt_record": txt_value,
        "instructions": (
            f"Add a DNS TXT record on '{asset.name}' with value '{txt_value}', "
            "then call POST /assets/{id}/verify. (Non-domain assets: an owner/admin "
            "may attest ownership via the verify endpoint.)"
        ),
    }


@router.post("/{asset_id}/verify")
async def verify_ownership(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    """Verify ownership. Domains: DNS TXT check. Other types: owner/admin attestation."""
    asset = await _get_owned_asset(db, asset_id, require_org(user.org_id))
    if asset.ownership_verified:
        return {"asset_id": asset.id, "ownership_verified": True, "method": "already_verified"}
    if not asset.verification_token:
        raise HTTPException(status_code=400, detail="Request a verification token first.")

    if asset.type == "domain":
        # Same DNS-TXT check the scheduler's background re-check uses.
        if not await domain_txt_matches(asset.name, asset.verification_token):
            raise HTTPException(
                status_code=400,
                detail="DNS TXT record not found yet. Add it and retry (propagation can take minutes).",
            )
        method = "dns_txt"
    else:
        # ip/cloud/repo/saas/user: owner/admin attests ownership (audited via role).
        if user.role not in ("owner", "admin"):
            raise HTTPException(
                status_code=403,
                detail="Only an owner or admin can attest ownership for this asset type.",
            )
        method = "attestation"

    asset.ownership_verified = True
    await db.commit()
    return {"asset_id": asset.id, "ownership_verified": True, "method": method}

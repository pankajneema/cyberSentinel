"""
Reports route (org-scoped, identity + RBAC).

Reports are generated from REAL tenant data: the `content` payload is computed
from the org's `assets` (and any available ASM/VS signals) at generation time.
Nothing is fabricated — when a data source is empty, the report says zero/empty
honestly rather than inventing findings or compliance numbers.

Tenancy: every query is filtered by `user.org_id`. Writes (generate/delete and
all scheduled-report mutations) are gated by RBAC; reads are open to all members.
"""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from reports_service import (
    _DEFAULT_SECTIONS,
    _build_report_content,
    _content_to_csv,
    _content_to_pdf,
    _next_run,
    _safe_filename,
    generate_scheduled_report,  # noqa: F401 — re-exported for the scheduler
)
from utils.database import get_db
from utils.auth import CurrentUser, get_current_user, require_role
from utils.tenancy import require_org
from utils.ownership import get_owned_or_404
from models.report_models import Report as ReportModel, ScheduledReport as ScheduledReportModel
from schemas.report_schema import (
    GenerateReportRequest,
    ReportResponse,
    ReportListResponse,
    ScheduledReportCreate,
    ScheduledReportUpdate,
    ScheduledReportResponse,
    ScheduledReportListResponse,
)

router = APIRouter(prefix="/api/v1/reports", tags=["Reports"])

# Roles allowed to generate / delete reports and manage schedules.
_writer = require_role("owner", "admin", "analyst")

_TYPE_LABEL = {
    "executive": "Executive Summary",
    "technical": "Technical Report",
    "compliance": "Compliance Mapping",
    "assets": "Asset Inventory",
    "vulnerability": "Vulnerability Report",
}


@router.post("/generate", response_model=ReportResponse)
async def generate_report(
    payload: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    org_id = require_org(user.org_id)

    content = await _build_report_content(db, org_id, payload)
    sections = payload.sections or list(_DEFAULT_SECTIONS)

    name = (payload.name or "").strip()
    if not name:
        label = _TYPE_LABEL.get(payload.report_type, "Report")
        name = f"{label} — {datetime.utcnow().strftime('%Y-%m-%d')}"

    size_bytes = len(json.dumps(content).encode("utf-8"))

    report = ReportModel(
        org_id=org_id,
        user_id=user.user_id,
        name=name,
        module=payload.module,
        report_type=payload.report_type,
        format=payload.format,
        date_range=payload.date_range,
        sections=sections,
        status="ready",
        content=content,
        size_bytes=size_bytes,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report.to_dict(include_content=True)


@router.get("", response_model=ReportListResponse)
async def list_reports(
    module: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    query = select(ReportModel).filter(ReportModel.org_id == org_id)
    if module and module != "all":
        query = query.filter(ReportModel.module == module)
    if q:
        query = query.filter(ReportModel.name.ilike(f"%{q}%"))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
    # Paginate: report rows carry large `content` JSON blobs — never load them all.
    query = query.order_by(ReportModel.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(query)).scalars().all()
    return ReportListResponse(items=[r.to_dict() for r in rows], total=total or 0)


async def _get_owned_report(db: AsyncSession, report_id: str, org_id: str) -> ReportModel:
    return await get_owned_or_404(db, ReportModel, report_id, org_id, detail="Report not found")


@router.get("/scheduled", response_model=ScheduledReportListResponse)
async def list_scheduled(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    org_id = require_org(user.org_id)
    rows = (
        await db.execute(
            select(ScheduledReportModel)
            .filter(ScheduledReportModel.org_id == org_id)
            .order_by(ScheduledReportModel.created_at.desc())
        )
    ).scalars().all()
    return ScheduledReportListResponse(items=[s.to_dict() for s in rows], total=len(rows))


@router.post("/scheduled", response_model=ScheduledReportResponse)
async def create_scheduled(
    payload: ScheduledReportCreate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    org_id = require_org(user.org_id)
    sched = ScheduledReportModel(
        org_id=org_id,
        user_id=user.user_id,
        name=payload.name,
        module=payload.module,
        report_type=payload.report_type,
        format=payload.format,
        frequency=payload.frequency,
        recipients=payload.recipients or [],
        enabled=payload.enabled,
        next_run_at=_next_run(payload.frequency) if payload.enabled else None,
    )
    db.add(sched)
    await db.commit()
    await db.refresh(sched)
    return sched.to_dict()


@router.patch("/scheduled/{sched_id}", response_model=ScheduledReportResponse)
async def update_scheduled(
    sched_id: str,
    payload: ScheduledReportUpdate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    org_id = require_org(user.org_id)
    sched = (
        await db.execute(
            select(ScheduledReportModel).filter(
                ScheduledReportModel.id == sched_id,
                ScheduledReportModel.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Scheduled report not found")

    data = payload.dict(exclude_unset=True)
    if "report_type" in data:
        sched.report_type = data.pop("report_type")
    for key, value in data.items():
        setattr(sched, key, value)

    # Recompute next run when frequency or enabled state changes.
    if sched.enabled:
        if "frequency" in data or "enabled" in data:
            sched.next_run_at = _next_run(sched.frequency)
    else:
        sched.next_run_at = None

    await db.commit()
    await db.refresh(sched)
    return sched.to_dict()


@router.delete("/scheduled/{sched_id}")
async def delete_scheduled(
    sched_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    org_id = require_org(user.org_id)
    sched = (
        await db.execute(
            select(ScheduledReportModel).filter(
                ScheduledReportModel.id == sched_id,
                ScheduledReportModel.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if not sched:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    await db.delete(sched)
    await db.commit()
    return {"message": "Scheduled report deleted"}


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    report = await _get_owned_report(db, report_id, require_org(user.org_id))
    return report.to_dict(include_content=True)


@router.get("/{report_id}/download")
async def download_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    report = await _get_owned_report(db, report_id, require_org(user.org_id))
    content = report.content or {}
    fmt = (report.format or "pdf").lower()

    if fmt == "json":
        body = json.dumps(content, indent=2)
        media = "application/json"
        fname = _safe_filename(report.name, "json")
    elif fmt == "csv":
        body = _content_to_csv(content)
        media = "text/csv"
        fname = _safe_filename(report.name, "csv")
    else:
        # "pdf" -> a real, binary PDF document rendered via ReportLab.
        body = _content_to_pdf(report)
        media = "application/pdf"
        fname = _safe_filename(report.name, "pdf")

    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.delete("/{report_id}")
async def delete_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(_writer),
):
    report = await _get_owned_report(db, report_id, require_org(user.org_id))
    await db.delete(report)
    await db.commit()
    return {"message": "Report deleted"}

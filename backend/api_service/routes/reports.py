"""
Reports route (org-scoped, Supabase identity + RBAC).

Reports are generated from REAL tenant data: the `content` payload is computed
from the org's `assets` (and any available ASM/VS signals) at generation time.
Nothing is fabricated — when a data source is empty, the report says zero/empty
honestly rather than inventing findings or compliance numbers.

Tenancy: every query is filtered by `user.org_id`. Writes (generate/delete and
all scheduled-report mutations) are gated by RBAC; reads are open to all members.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from utils.database import get_db
from utils.supabase_auth import CurrentUser, get_current_user, require_role
from utils.tenancy import require_org
from models.asset_models import Asset as AssetModel
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

_DEFAULT_SECTIONS = ["summary", "assets", "vulnerabilities", "recommendations"]

_TYPE_LABEL = {
    "executive": "Executive Summary",
    "technical": "Technical Report",
    "compliance": "Compliance Mapping",
    "assets": "Asset Inventory",
    "vulnerability": "Vulnerability Report",
}


# ---------------------------------------------------------------------------
# Real content generation — derives everything from the org's actual assets.
# ---------------------------------------------------------------------------
async def _build_report_content(
    db: AsyncSession, org_id: str, payload: GenerateReportRequest
) -> dict:
    rows = (
        await db.execute(select(AssetModel).filter(AssetModel.org_id == org_id))
    ).scalars().all()

    total_assets = len(rows)
    public_assets = sum(1 for a in rows if a.exposure == "public")
    internal_assets = total_assets - public_assets

    type_breakdown: dict[str, int] = {}
    for a in rows:
        t = a.type or "unknown"
        type_breakdown[t] = type_breakdown.get(t, 0) + 1

    # Exposure/risk buckets from REAL computed risk_score. NULL = never scored.
    buckets = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0, "unscanned": 0}
    for a in rows:
        rs = a.risk_score
        if rs is None:
            buckets["unscanned"] += 1
        elif rs >= 80:
            buckets["critical"] += 1
        elif rs >= 60:
            buckets["high"] += 1
        elif rs >= 40:
            buckets["medium"] += 1
        elif rs >= 20:
            buckets["low"] += 1
        else:
            buckets["info"] += 1

    scored = [a for a in rows if a.risk_score is not None]
    top_exposed = sorted(scored, key=lambda a: a.risk_score, reverse=True)[:10]
    top_exposed_out = [
        {
            "name": a.name,
            "type": a.type,
            "exposure": a.exposure,
            "risk_score": a.risk_score,
        }
        for a in top_exposed
    ]

    # Key findings — only emit when grounded in real data.
    key_findings: list[dict] = []
    crit_high = buckets["critical"] + buckets["high"]
    if crit_high:
        key_findings.append({
            "severity": "high",
            "title": f"{crit_high} asset(s) with high or critical exposure score",
            "count": crit_high,
        })
    if public_assets:
        key_findings.append({
            "severity": "medium",
            "title": f"{public_assets} internet-facing (public) asset(s) in inventory",
            "count": public_assets,
        })
    if buckets["unscanned"]:
        key_findings.append({
            "severity": "low",
            "title": f"{buckets['unscanned']} asset(s) have never been scanned (Unscanned)",
            "count": buckets["unscanned"],
        })

    # Recommendations — derived strictly from real findings.
    recommendations: list[str] = []
    if crit_high:
        recommendations.append(
            f"Prioritize remediation of the {crit_high} high/critical-exposure asset(s); "
            "review open ports and TLS configuration on the top exposed hosts."
        )
    if public_assets:
        recommendations.append(
            f"Audit the {public_assets} public-facing asset(s) to confirm each must be "
            "internet-reachable; move non-essential services behind the perimeter."
        )
    if buckets["unscanned"]:
        recommendations.append(
            f"Run an ASM discovery to score the {buckets['unscanned']} unscanned asset(s) "
            "so their exposure can be measured."
        )
    if total_assets == 0:
        recommendations.append(
            "No assets are recorded yet. Add assets to the inventory to begin attack-surface analysis."
        )

    # Vulnerabilities: the VS module is in-memory and currently has no persisted
    # store reachable here. Report honestly rather than fabricate.
    vulnerabilities = {
        "total": 0,
        "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
        "note": "No persisted vulnerability scan data is available for this organization yet.",
    }

    content = {
        "meta": {
            "module": payload.module,
            "report_type": payload.report_type,
            "date_range": payload.date_range,
            "generated_at": datetime.utcnow().isoformat() + "Z",
        },
        "summary": {
            "total_assets": total_assets,
            "public_assets": public_assets,
            "internal_assets": internal_assets,
            "type_breakdown": type_breakdown,
            "exposure_breakdown": buckets,
        },
        "top_exposed_assets": top_exposed_out,
        "vulnerabilities": vulnerabilities,
        "key_findings": key_findings,
        "recommendations": recommendations,
    }
    return content


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
    query = query.order_by(ReportModel.created_at.desc())
    rows = (await db.execute(query)).scalars().all()
    return ReportListResponse(items=[r.to_dict() for r in rows], total=total or 0)


async def _get_owned_report(db: AsyncSession, report_id: str, org_id: str) -> ReportModel:
    report = (
        await db.execute(
            select(ReportModel).filter(
                ReportModel.id == report_id,
                ReportModel.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


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


def _next_run(frequency: str) -> datetime:
    now = datetime.utcnow()
    if frequency == "daily":
        return now + timedelta(days=1)
    if frequency == "monthly":
        return now + timedelta(days=30)
    return now + timedelta(weeks=1)  # weekly default


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


def _safe_filename(name: str, ext: str) -> str:
    base = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in (name or "report"))
    return f"{base or 'report'}.{ext}"


def _content_to_csv(content: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    summary = content.get("summary", {}) or {}
    w.writerow(["Section", "Metric", "Value"])
    w.writerow(["Summary", "Total assets", summary.get("total_assets", 0)])
    w.writerow(["Summary", "Public assets", summary.get("public_assets", 0)])
    w.writerow(["Summary", "Internal assets", summary.get("internal_assets", 0)])
    for t, n in (summary.get("type_breakdown", {}) or {}).items():
        w.writerow(["Type breakdown", t, n])
    for sev, n in (summary.get("exposure_breakdown", {}) or {}).items():
        w.writerow(["Exposure breakdown", sev, n])
    w.writerow([])
    w.writerow(["Top exposed asset", "Type", "Exposure", "Risk score"])
    for a in content.get("top_exposed_assets", []) or []:
        w.writerow([a.get("name"), a.get("type"), a.get("exposure"), a.get("risk_score")])
    w.writerow([])
    w.writerow(["Key finding", "Severity", "Count"])
    for f in content.get("key_findings", []) or []:
        w.writerow([f.get("title"), f.get("severity"), f.get("count")])
    w.writerow([])
    w.writerow(["Recommendations"])
    for r in content.get("recommendations", []) or []:
        w.writerow([r])
    return buf.getvalue()


def _content_to_html(report: ReportModel) -> str:
    c = report.content or {}
    summary = c.get("summary", {}) or {}
    rows_types = "".join(
        f"<li>{t}: {n}</li>" for t, n in (summary.get("type_breakdown", {}) or {}).items()
    )
    rows_exposure = "".join(
        f"<li>{s}: {n}</li>" for s, n in (summary.get("exposure_breakdown", {}) or {}).items()
    )
    rows_top = "".join(
        f"<tr><td>{a.get('name')}</td><td>{a.get('type')}</td>"
        f"<td>{a.get('exposure')}</td><td>{a.get('risk_score')}</td></tr>"
        for a in (c.get("top_exposed_assets", []) or [])
    )
    rows_findings = "".join(
        f"<li><strong>{f.get('severity')}</strong> — {f.get('title')} ({f.get('count')})</li>"
        for f in (c.get("key_findings", []) or [])
    ) or "<li>No findings.</li>"
    rows_recs = "".join(
        f"<li>{r}</li>" for r in (c.get("recommendations", []) or [])
    ) or "<li>No recommendations.</li>"
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{report.name}</title>
<style>body{{font-family:Arial,Helvetica,sans-serif;color:#111;margin:40px;}}
h1{{font-size:22px;}}h2{{font-size:16px;margin-top:24px;}}
table{{border-collapse:collapse;width:100%;}}td,th{{border:1px solid #ddd;padding:6px;text-align:left;}}
.muted{{color:#666;font-size:12px;}}</style></head>
<body>
<h1>{report.name}</h1>
<p class="muted">Module: {report.module} · Type: {report.report_type} · Generated: {summary and c.get('meta', {}).get('generated_at', '')}</p>
<h2>Summary</h2>
<ul>
<li>Total assets: {summary.get('total_assets', 0)}</li>
<li>Public assets: {summary.get('public_assets', 0)}</li>
<li>Internal assets: {summary.get('internal_assets', 0)}</li>
</ul>
<h2>Asset types</h2><ul>{rows_types or '<li>None</li>'}</ul>
<h2>Exposure breakdown</h2><ul>{rows_exposure or '<li>None</li>'}</ul>
<h2>Top exposed assets</h2>
<table><tr><th>Name</th><th>Type</th><th>Exposure</th><th>Risk score</th></tr>{rows_top or '<tr><td colspan=4>None</td></tr>'}</table>
<h2>Key findings</h2><ul>{rows_findings}</ul>
<h2>Recommendations</h2><ol>{rows_recs}</ol>
</body></html>"""


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
        # "pdf" -> a self-contained, printable HTML document (no heavy deps).
        body = _content_to_html(report)
        media = "text/html"
        fname = _safe_filename(report.name, "html")

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

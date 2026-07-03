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
import html
import io
import json
import logging
import os
from datetime import datetime, timedelta

logger = logging.getLogger("cybersentinel.reports")
PRODUCT_NAME_FOR_REPORTS = os.getenv("PRODUCT_NAME", "CyberSentinel")

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from utils.database import get_db
from utils.emailer import send_email
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

    # Full per-asset detail — only surfaced in technical reports (raw host list).
    assets_detail = [
        {
            "name": a.name,
            "type": a.type,
            "exposure": a.exposure,
            "risk_score": a.risk_score,
            "status": a.status,
            "last_seen": a.last_seen,
        }
        for a in rows
    ]

    # Compliance control mapping — derived from the buckets already computed.
    scored_count = total_assets - buckets["unscanned"]

    def _ctrl(status: str, detail: str, control: str) -> dict:
        return {"control": control, "status": status, "detail": detail}

    compliance_controls = [
        _ctrl(
            "pass" if total_assets else "fail",
            f"{total_assets} asset(s) tracked in inventory",
            "Asset Inventory & Ownership (CIS Control 1)",
        ),
        _ctrl(
            "pass" if (total_assets and buckets["unscanned"] == 0)
            else ("partial" if scored_count else "fail"),
            f"{scored_count}/{total_assets} asset(s) scored, {buckets['unscanned']} never scanned",
            "Continuous Vulnerability Management (CIS Control 7)",
        ),
        _ctrl(
            "fail" if crit_high else "pass",
            f"{crit_high} asset(s) at high/critical exposure",
            "Exposure Remediation (CIS Control 7.1)",
        ),
        _ctrl(
            "review" if public_assets else "pass",
            f"{public_assets} internet-facing asset(s) in scope",
            "Attack Surface Minimization (CIS Control 4)",
        ),
    ]

    # Vulnerabilities: the VS module is in-memory and currently has no persisted
    # store reachable here. Report honestly rather than fabricate.
    vulnerabilities = {
        "total": 0,
        "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
        "note": "No persisted vulnerability scan data is available for this organization yet.",
    }

    report_type = (payload.report_type or "executive").lower()

    meta = {
        "module": payload.module,
        "report_type": report_type,
        "date_range": payload.date_range,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    summary = {
        "total_assets": total_assets,
        "public_assets": public_assets,
        "internal_assets": internal_assets,
        "type_breakdown": type_breakdown,
        "exposure_breakdown": buckets,
    }

    # ------------------------------------------------------------------
    # Report-type branching: the same real org data, different sections /
    # verbosity per audience. Nothing fabricated — sections are omitted,
    # never invented.
    # ------------------------------------------------------------------
    if report_type == "technical":
        # Full detail: every asset row plus exposure tables and findings.
        content = {
            "meta": meta,
            "sections_included": [
                "summary", "assets", "top_exposed_assets",
                "vulnerabilities", "key_findings", "recommendations",
            ],
            "summary": summary,
            "assets_detail": assets_detail,
            "top_exposed_assets": top_exposed_out,
            "vulnerabilities": vulnerabilities,
            "key_findings": key_findings,
            "recommendations": recommendations,
        }
    elif report_type == "customer":
        # Branded, audience-friendly: findings + recommendations only.
        content = {
            "meta": meta,
            "sections_included": ["overview", "key_findings", "recommendations"],
            "branding": {
                "product": PRODUCT_NAME_FOR_REPORTS,
                "prepared_for": "Customer",
                "tagline": f"Security posture summary prepared by {PRODUCT_NAME_FOR_REPORTS}",
            },
            "summary": {
                "total_assets": total_assets,
                "public_assets": public_assets,
            },
            "key_findings": key_findings,
            "recommendations": recommendations,
        }
    elif report_type == "compliance":
        # Control-oriented: map computed buckets to compliance controls.
        content = {
            "meta": meta,
            "sections_included": [
                "summary", "compliance_controls", "key_findings", "recommendations",
            ],
            "summary": summary,
            "compliance_controls": compliance_controls,
            "key_findings": key_findings,
            "recommendations": recommendations,
        }
    else:
        # executive (default): high-level summary, no raw host lists.
        content = {
            "meta": meta,
            "sections_included": [
                "summary", "top_exposed_assets", "key_findings", "recommendations",
            ],
            "summary": summary,
            "top_exposed_assets": top_exposed_out,
            "vulnerabilities": {
                "total": vulnerabilities["total"],
                "by_severity": vulnerabilities["by_severity"],
            },
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


async def generate_scheduled_report(db: AsyncSession, sched) -> "ReportModel":
    """Generate one report from a ScheduledReport row and advance its next_run_at.

    Called by the background scheduler when a schedule is due. Reuses the exact same
    real-data content builder as the manual /generate endpoint — no fabricated data.
    """
    payload = GenerateReportRequest(
        name=f"{sched.name} — {datetime.utcnow().strftime('%Y-%m-%d')}",
        module=sched.module or "all",
        report_type=sched.report_type or "executive",
        format=sched.format or "pdf",
        date_range="all",
        sections=None,
    )
    content = await _build_report_content(db, sched.org_id, payload)
    report = ReportModel(
        org_id=sched.org_id,
        user_id=sched.user_id,
        name=payload.name,
        module=payload.module,
        report_type=payload.report_type,
        format=payload.format,
        date_range=payload.date_range,
        sections=list(_DEFAULT_SECTIONS),
        status="ready",
        content=content,
        size_bytes=len(json.dumps(content).encode("utf-8")),
    )
    db.add(report)
    # Advance the schedule so it fires again next period.
    sched.next_run_at = _next_run(sched.frequency)
    await db.commit()
    await db.refresh(report)

    # Deliver to recipients (best-effort; send_email no-ops safely if SMTP is
    # unconfigured, so this never breaks the scheduler).
    recipients = list(sched.recipients or [])
    if recipients:
        try:
            fmt = (report.format or "pdf").lower()
            if fmt == "csv":
                attachment = _content_to_csv(report.content or {}).encode("utf-8")
                att_name = _safe_filename(report.name, "csv")
                att_mime = "text/csv"
            elif fmt == "json":
                attachment = json.dumps(report.content or {}, indent=2).encode("utf-8")
                att_name = _safe_filename(report.name, "json")
                att_mime = "application/json"
            else:
                attachment = _content_to_pdf(report)
                att_name = _safe_filename(report.name, "pdf")
                att_mime = "application/pdf"

            subject = f"[{PRODUCT_NAME_FOR_REPORTS}] {report.name}"
            body = (
                f"<p>Your scheduled report <strong>{report.name}</strong> is attached "
                f"as <code>{att_name}</code>.</p>"
            )
            for addr in recipients:
                send_email(
                    addr, subject, body, is_html=True,
                    attachment=attachment,
                    attachment_filename=att_name,
                    attachment_mimetype=att_mime,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("scheduled report %s generated but delivery failed: %s", sched.id, exc)

    return report


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


def _csv_safe(v):
    """Neutralize CSV/spreadsheet formula injection (=, +, -, @, tab, CR).

    A scanner-controlled asset name like `=HYPERLINK(...)` would otherwise
    execute when the exported CSV is opened in Excel/Sheets.
    """
    s = "" if v is None else str(v)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def _content_to_csv(content: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    summary = content.get("summary", {}) or {}
    w.writerow(["Section", "Metric", "Value"])
    w.writerow(["Summary", "Total assets", summary.get("total_assets", 0)])
    w.writerow(["Summary", "Public assets", summary.get("public_assets", 0)])
    w.writerow(["Summary", "Internal assets", summary.get("internal_assets", 0)])
    for t, n in (summary.get("type_breakdown", {}) or {}).items():
        w.writerow(["Type breakdown", _csv_safe(t), n])
    for sev, n in (summary.get("exposure_breakdown", {}) or {}).items():
        w.writerow(["Exposure breakdown", _csv_safe(sev), n])
    w.writerow([])
    w.writerow(["Top exposed asset", "Type", "Exposure", "Risk score"])
    for a in content.get("top_exposed_assets", []) or []:
        w.writerow([_csv_safe(a.get("name")), _csv_safe(a.get("type")), _csv_safe(a.get("exposure")), a.get("risk_score")])
    w.writerow([])
    w.writerow(["Key finding", "Severity", "Count"])
    for f in content.get("key_findings", []) or []:
        w.writerow([_csv_safe(f.get("title")), _csv_safe(f.get("severity")), f.get("count")])
    w.writerow([])
    w.writerow(["Recommendations"])
    for r in content.get("recommendations", []) or []:
        w.writerow([_csv_safe(r)])
    return buf.getvalue()


def _content_to_html(report: ReportModel) -> str:
    # All values below may contain scanner- or user-controlled strings (asset
    # names, finding titles, report name). Escape every interpolation to prevent
    # stored XSS in the downloaded HTML report.
    h = lambda v: html.escape("" if v is None else str(v))
    c = report.content or {}
    summary = c.get("summary", {}) or {}
    rows_types = "".join(
        f"<li>{h(t)}: {h(n)}</li>" for t, n in (summary.get("type_breakdown", {}) or {}).items()
    )
    rows_exposure = "".join(
        f"<li>{h(s)}: {h(n)}</li>" for s, n in (summary.get("exposure_breakdown", {}) or {}).items()
    )
    rows_top = "".join(
        f"<tr><td>{h(a.get('name'))}</td><td>{h(a.get('type'))}</td>"
        f"<td>{h(a.get('exposure'))}</td><td>{h(a.get('risk_score'))}</td></tr>"
        for a in (c.get("top_exposed_assets", []) or [])
    )
    rows_findings = "".join(
        f"<li><strong>{h(f.get('severity'))}</strong> — {h(f.get('title'))} ({h(f.get('count'))})</li>"
        for f in (c.get("key_findings", []) or [])
    ) or "<li>No findings.</li>"
    rows_recs = "".join(
        f"<li>{h(r)}</li>" for r in (c.get("recommendations", []) or [])
    ) or "<li>No recommendations.</li>"
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{h(report.name)}</title>
<style>body{{font-family:Arial,Helvetica,sans-serif;color:#111;margin:40px;}}
h1{{font-size:22px;}}h2{{font-size:16px;margin-top:24px;}}
table{{border-collapse:collapse;width:100%;}}td,th{{border:1px solid #ddd;padding:6px;text-align:left;}}
.muted{{color:#666;font-size:12px;}}</style></head>
<body>
<h1>{h(report.name)}</h1>
<p class="muted">Module: {h(report.module)} · Type: {h(report.report_type)} · Generated: {h(summary and c.get('meta', {}).get('generated_at', ''))}</p>
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


def _content_to_pdf(report: ReportModel) -> bytes:
    """Render the report `content` dict into real PDF bytes via ReportLab.

    Only the sections present in `content` are rendered, so executive /
    technical / customer / compliance reports each produce a genuinely
    different document. All interpolated strings are scanner/user-controlled;
    ReportLab's Paragraph auto-escapes markup, and we additionally route text
    through html.escape for defence in depth.
    """
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    h = lambda v: html.escape("" if v is None else str(v))
    c = report.content or {}
    summary = c.get("summary", {}) or {}
    meta = c.get("meta", {}) or {}

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Sub", parent=styles["Normal"], textColor=colors.grey, fontSize=9))
    body = styles["Normal"]
    h2 = ParagraphStyle(name="H2c", parent=styles["Heading2"], spaceBefore=14, alignment=TA_LEFT)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=(report.name or "Report"),
    )
    story = []

    story.append(Paragraph(h(report.name), styles["Title"]))
    story.append(Paragraph(
        f"Module: {h(report.module)} &middot; Type: {h(report.report_type)} "
        f"&middot; Generated: {h(meta.get('generated_at', ''))}",
        styles["Sub"],
    ))

    branding = c.get("branding")
    if branding:
        story.append(Spacer(1, 6))
        story.append(Paragraph(h(branding.get("tagline", "")), styles["Sub"]))

    def _table(header, data_rows, col_widths=None):
        table_data = [[Paragraph(f"<b>{h(x)}</b>", body) for x in header]]
        for r in data_rows:
            table_data.append([Paragraph(h(x), body) for x in r])
        t = Table(table_data, colWidths=col_widths, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
        ]))
        return t

    # Summary
    if summary:
        story.append(Paragraph("Summary", h2))
        srows = [
            ["Total assets", summary.get("total_assets", 0)],
            ["Public assets", summary.get("public_assets", 0)],
        ]
        if "internal_assets" in summary:
            srows.append(["Internal assets", summary.get("internal_assets", 0)])
        story.append(_table(["Metric", "Value"], srows, col_widths=[90 * mm, 80 * mm]))

        tb = summary.get("type_breakdown") or {}
        if tb:
            story.append(Paragraph("Asset types", h2))
            story.append(_table(["Type", "Count"], list(tb.items()), col_widths=[90 * mm, 80 * mm]))

        eb = summary.get("exposure_breakdown") or {}
        if eb:
            story.append(Paragraph("Exposure breakdown", h2))
            story.append(_table(["Severity", "Count"], list(eb.items()), col_widths=[90 * mm, 80 * mm]))

    # Compliance controls (compliance reports)
    controls = c.get("compliance_controls")
    if controls:
        story.append(Paragraph("Compliance controls", h2))
        story.append(_table(
            ["Control", "Status", "Detail"],
            [[x.get("control"), x.get("status"), x.get("detail")] for x in controls],
            col_widths=[70 * mm, 25 * mm, 79 * mm],
        ))

    # Top exposed assets (executive / technical)
    top = c.get("top_exposed_assets")
    if top:
        story.append(Paragraph("Top exposed assets", h2))
        story.append(_table(
            ["Name", "Type", "Exposure", "Risk"],
            [[a.get("name"), a.get("type"), a.get("exposure"), a.get("risk_score")] for a in top],
            col_widths=[74 * mm, 34 * mm, 34 * mm, 32 * mm],
        ))

    # Full asset detail (technical only)
    detail = c.get("assets_detail")
    if detail:
        story.append(Paragraph("Asset inventory (full)", h2))
        story.append(_table(
            ["Name", "Type", "Exposure", "Risk", "Status"],
            [[a.get("name"), a.get("type"), a.get("exposure"), a.get("risk_score"), a.get("status")] for a in detail],
            col_widths=[58 * mm, 28 * mm, 28 * mm, 24 * mm, 36 * mm],
        ))

    # Key findings
    story.append(Paragraph("Key findings", h2))
    findings = c.get("key_findings") or []
    if findings:
        for f in findings:
            story.append(Paragraph(
                f"&bull; <b>{h(f.get('severity'))}</b> — {h(f.get('title'))} ({h(f.get('count'))})",
                body,
            ))
    else:
        story.append(Paragraph("No findings.", body))

    # Recommendations
    story.append(Paragraph("Recommendations", h2))
    recs = c.get("recommendations") or []
    if recs:
        for i, r in enumerate(recs, 1):
            story.append(Paragraph(f"{i}. {h(r)}", body))
    else:
        story.append(Paragraph("No recommendations.", body))

    doc.build(story)
    return buf.getvalue()


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

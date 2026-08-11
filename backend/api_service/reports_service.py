"""
Report content generation, rendering (CSV/PDF) and scheduled-report
generation. Non-HTTP report logic shared by routes/reports.py and the
background scheduler (no import cycle: this module never imports routes).
"""

from __future__ import annotations

import csv
import html
import io
import json
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.asset_models import Asset as AssetModel
from models.report_models import Report as ReportModel
from models.vs_models import VsFinding
from notificationservice.email import send_email
from schemas.report_schema import GenerateReportRequest

_ACTIVE_VS_STATES = ("open", "confirmed", "in_progress")

logger = logging.getLogger("cybersentinel.reports")
PRODUCT_NAME_FOR_REPORTS = os.getenv("PRODUCT_NAME", "CyberSentinel")

_DEFAULT_SECTIONS = ["summary", "assets", "vulnerabilities", "recommendations"]


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

    # Vulnerabilities: real, active (open/confirmed/in_progress) VS findings for
    # this org. Resolved findings (remediated/verified/closed/accepted_risk/
    # false_positive) are excluded — a report should reflect current exposure.
    vs_rows = (
        await db.execute(
            select(VsFinding).filter(
                VsFinding.org_id == org_id,
                VsFinding.status.in_(_ACTIVE_VS_STATES),
            )
        )
    ).scalars().all()
    vs_by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in vs_rows:
        sev = (f.severity or "").lower()
        if sev in vs_by_severity:
            vs_by_severity[sev] += 1
    vulnerabilities = {
        "total": len(vs_rows),
        "by_severity": vs_by_severity,
        "note": None if vs_rows else "No open vulnerability findings for this organization.",
    }
    vs_crit_high = vs_by_severity["critical"] + vs_by_severity["high"]
    if vs_crit_high:
        key_findings.append({
            "severity": "high",
            "title": f"{vs_crit_high} open critical/high vulnerability finding(s) from VS scans",
            "count": vs_crit_high,
        })
        recommendations.append(
            f"Remediate the {vs_crit_high} open critical/high vulnerability finding(s) "
            "surfaced by Vulnerability Scanning, prioritized by CVSS/EPSS/KEV composite risk."
        )

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
    elif report_type == "assets":
        # Pure inventory export: every asset row, type/exposure breakdown, no
        # vulnerability or compliance content (that's what the other types are for).
        content = {
            "meta": meta,
            "sections_included": ["summary", "assets"],
            "summary": summary,
            "assets_detail": assets_detail,
        }
    elif report_type == "vulnerability":
        # Full per-finding detail from real VS scan data — the whole point of
        # this report type, so unlike top_exposed_assets it is not capped.
        vulnerabilities_detail = [f.to_dict() for f in vs_rows]
        content = {
            "meta": meta,
            "sections_included": [
                "summary", "vulnerabilities", "key_findings", "recommendations",
            ],
            "summary": {
                "total_assets": total_assets,
                "public_assets": public_assets,
                "internal_assets": internal_assets,
            },
            "vulnerabilities": vulnerabilities,
            "vulnerabilities_detail": vulnerabilities_detail,
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


def _next_run(frequency: str) -> datetime:
    now = datetime.utcnow()
    if frequency == "daily":
        return now + timedelta(days=1)
    if frequency == "monthly":
        return now + timedelta(days=30)
    return now + timedelta(weeks=1)  # weekly default


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
    vulns = content.get("vulnerabilities") or {}
    if vulns:
        w.writerow([])
        w.writerow(["Vulnerabilities by severity", "Count"])
        for sev, n in (vulns.get("by_severity", {}) or {}).items():
            w.writerow([_csv_safe(sev), n])
    detail = content.get("vulnerabilities_detail") or []
    if detail:
        w.writerow([])
        w.writerow(["Finding", "Severity", "CVE", "Composite risk", "Status", "Asset ID"])
        for f in detail:
            w.writerow([
                _csv_safe(f.get("title")), _csv_safe(f.get("severity")), _csv_safe(f.get("cve_id")),
                f.get("composite_risk"), _csv_safe(f.get("status")), _csv_safe(f.get("asset_id")),
            ])
    w.writerow([])
    w.writerow(["Key finding", "Severity", "Count"])
    for f in content.get("key_findings", []) or []:
        w.writerow([_csv_safe(f.get("title")), _csv_safe(f.get("severity")), f.get("count")])
    w.writerow([])
    w.writerow(["Recommendations"])
    for r in content.get("recommendations", []) or []:
        w.writerow([_csv_safe(r)])
    return buf.getvalue()


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

    # Vulnerabilities by severity (executive / technical / vulnerability)
    vulns = c.get("vulnerabilities") or {}
    by_sev = vulns.get("by_severity") or {}
    if any(by_sev.values()):
        story.append(Paragraph("Vulnerabilities by severity", h2))
        story.append(_table(["Severity", "Count"], list(by_sev.items()), col_widths=[90 * mm, 80 * mm]))

    # Full vulnerability finding detail (vulnerability report only)
    vuln_detail = c.get("vulnerabilities_detail")
    if vuln_detail:
        story.append(Paragraph("Vulnerability findings (full)", h2))
        story.append(_table(
            ["Title", "Severity", "CVE", "Risk", "Status"],
            [[f.get("title"), f.get("severity"), f.get("cve_id") or "—", f.get("composite_risk"), f.get("status")]
             for f in vuln_detail],
            col_widths=[64 * mm, 24 * mm, 28 * mm, 18 * mm, 40 * mm],
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

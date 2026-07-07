"""CA domain service.

Report-data assembly and PDF rendering for the compliance report export.
Evaluation semantics live in ca/engine.py; this module holds the non-HTTP
report logic called by routes/ca.py.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ca.engine import posture_counts
from models.ca_models import (
    CaControl, CaControlState, CaEvidence, CaEvidenceControlLink, CaFramework, CaGap,
)


async def _framework_report_data(db: AsyncSession, org_id: str, framework: CaFramework) -> dict:
    counts = await posture_counts(db, org_id, framework.id)
    rows = (
        await db.execute(
            select(CaControl, CaControlState)
            .join(CaControlState, (CaControlState.control_id == CaControl.id)
                  & (CaControlState.org_id == org_id))
            .where(CaControl.framework_id == framework.id)
            .order_by(CaControl.control_ref)
        )
    ).all()
    control_ids = [c.id for c, _ in rows]
    ev_rows = (
        await db.execute(
            select(CaEvidenceControlLink.control_id, CaEvidence)
            .join(CaEvidence, CaEvidence.id == CaEvidenceControlLink.evidence_id)
            .where(
                CaEvidenceControlLink.control_id.in_(control_ids) if control_ids else False,
                CaEvidence.org_id == org_id,
                CaEvidence.status == "valid",
            )
        )
    ).all() if control_ids else []
    ev_by_control: dict[str, list] = {}
    for cid, ev in ev_rows:
        ev_by_control.setdefault(cid, []).append({
            "id": ev.id, "collection": ev.collection, "source_type": ev.source_type,
            "summary": ev.summary, "result": ev.result, "content_hash": ev.content_hash,
            "captured_at": ev.captured_at.isoformat() if ev.captured_at else None,
            "valid_until": ev.valid_until.isoformat() if ev.valid_until else None,
        })
    open_gaps = (
        await db.execute(
            select(func.count(CaGap.id)).where(
                CaGap.org_id == org_id,
                CaGap.control_id.in_(control_ids) if control_ids else False,
                CaGap.status.in_(("open", "in_progress")),
            )
        )
    ).scalar() or 0
    return {
        "framework": {"key": framework.key, "name": framework.name, "version": framework.version},
        "generated_at": datetime.utcnow().isoformat(),
        "posture": counts,
        "open_gaps": open_gaps,
        "controls": [
            {
                "control_ref": c.control_ref, "title": c.title, "category": c.category,
                "criticality": c.criticality, "status": s.status,
                "computed_at": s.computed_at.isoformat() if s.computed_at else None,
                "na_justification": s.na_justification,
                "evidence": ev_by_control.get(c.id, []),
            }
            for c, s in rows
        ],
    }


def _report_pdf(reports: list[dict]) -> bytes:
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from reportlab.lib import colors

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.5 * cm, rightMargin=1.5 * cm)
    styles = getSampleStyleSheet()
    story = [Paragraph("CyberSentinel — Compliance Report", styles["Title"]),
             Paragraph(f"Generated {datetime.utcnow():%Y-%m-%d %H:%M} UTC · "
                       "All statuses computed from live control states; scores use "
                       "floor((satisfied + 0.5·partial) / applicable × 100).", styles["Normal"]),
             Spacer(1, 12)]
    for rep in reports:
        p = rep["posture"]
        score = "n/a" if p["score"] is None else f"{p['score']:.0f}%"
        story.append(Paragraph(
            f"{rep['framework']['name']} v{rep['framework']['version']} — {score}", styles["Heading1"]))
        story.append(Paragraph(
            f"{p['satisfied']} satisfied · {p['partial']} partial · {p['gap']} gap · "
            f"{p['unknown']} not assessed · {p['not_applicable']} N/A · "
            f"{rep['open_gaps']} open remediation gap(s)", styles["Normal"]))
        story.append(Spacer(1, 8))
        data = [["Ref", "Control", "Status", "Evidence (valid)"]]
        for c in rep["controls"]:
            ev_txt = "; ".join(
                f"[{e['collection']}] {e['summary'] or e['source_type']}" for e in c["evidence"][:3]
            ) or ("N/A: " + (c["na_justification"] or "") if c["status"] == "not_applicable" else "—")
            data.append([
                Paragraph(c["control_ref"], styles["BodyText"]),
                Paragraph(c["title"], styles["BodyText"]),
                c["status"],
                Paragraph(ev_txt[:300], styles["BodyText"]),
            ])
        t = Table(data, colWidths=[2.2 * cm, 5.5 * cm, 2.4 * cm, 7.5 * cm], repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8f5")),
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(t)
        story.append(Spacer(1, 16))
    doc.build(story)
    return buf.getvalue()

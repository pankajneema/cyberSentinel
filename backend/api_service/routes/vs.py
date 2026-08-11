# routes/vs.py
#
# Vulnerability Scanning (VS) API — REAL, DB-backed. Replaces the former
# in-memory stub (scans_db/results_db are gone). Every value comes from the
# database; empty tenants return honest zeros/empty lists.
#
# Tenancy: all queries filter by the caller's verified org_id. Writes are gated
# by RBAC (owner/admin/analyst). Scans are only enqueued for ownership-verified
# assets, and targets are SSRF-validated. See docs/VS-MODULE-DESIGN.md.

from __future__ import annotations

import html
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from utils.database import get_db
from utils.auth import CurrentUser, get_current_user, require_role
from utils.tenancy import require_org
from utils.ownership import get_owned_or_404
from utils.lifecycle import validate_transition
from utils.pagination import page_params, paginate
from utils.target_guard import validate_scan_target
from vs.service import build_job_message, enqueue_run
from models.vs_models import (
    VsScan, VsScanProfile, VsScanRun, VsScanTarget,
    VsFinding, VsFindingHistory, VsCveMetadata, VsCredential, VsTrendSnapshot,
)
from models.asset_models import Asset as AssetModel
from schemas.vs_schema import (
    VsProfileCreate, VsProfileResponse, VsScanCreate, VsScanUpdate, VsScanResponse,
    VsFindingResponse, VsFindingStatusUpdate, VsFindingAssign,
    VsDashboardResponse, VsCveResponse, VsCredentialCreate, VsCredentialResponse,
)

logger = logging.getLogger("cybersentinel.vs")

vs_router = APIRouter(prefix="/api/v1/vs", tags=["Vulnerability Scanning (VS)"])

_writer = require_role("owner", "admin", "analyst")

# Lifecycle state machine (Domain 5).
_TRANSITIONS: dict[str, set[str]] = {
    "open": {"confirmed", "false_positive", "accepted_risk"},
    "confirmed": {"in_progress", "false_positive", "accepted_risk"},
    "in_progress": {"remediated", "accepted_risk"},
    "remediated": {"verified", "in_progress"},
    "verified": {"closed", "in_progress"},   # reopen if it reappears
    "closed": {"in_progress"},
    "accepted_risk": {"in_progress", "confirmed"},
    "false_positive": {"open"},
}
_JUSTIFY_REQUIRED = {"accepted_risk", "false_positive"}
_RESOLVED_STATES = {"remediated", "verified", "closed", "accepted_risk", "false_positive"}


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------
@vs_router.post("/profiles", response_model=VsProfileResponse)
async def create_profile(payload: VsProfileCreate, db: AsyncSession = Depends(get_db),
                         user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    p = VsScanProfile(
        org_id=org_id, user_id=user.user_id, name=payload.name, intensity=payload.intensity,
        engines=payload.engines, authenticated=payload.authenticated,
        credential_id=payload.credential_id, safe_mode=payload.safe_mode,
        max_requests_per_sec=payload.max_requests_per_sec, scan_window=payload.scan_window,
        web_scan=payload.web_scan,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p.to_dict()


@vs_router.get("/profiles", response_model=list[VsProfileResponse])
async def list_profiles(db: AsyncSession = Depends(get_db),
                        user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    rows = (await db.execute(
        select(VsScanProfile).where(VsScanProfile.org_id == org_id)
        .order_by(VsScanProfile.created_at.desc())
    )).scalars().all()
    return [p.to_dict() for p in rows]


@vs_router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str, db: AsyncSession = Depends(get_db),
                         user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    p = (await db.execute(select(VsScanProfile).where(
        VsScanProfile.id == profile_id, VsScanProfile.org_id == org_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Profile not found")
    await db.delete(p)
    await db.commit()
    return {"deleted": profile_id}


# ---------------------------------------------------------------------------
# Scans
# ---------------------------------------------------------------------------
async def _owned_scan(scan_id: str, db: AsyncSession, org_id: str) -> VsScan:
    return await get_owned_or_404(
        db, VsScan, scan_id, org_id, detail="Scan not found",
        extra_criteria=(VsScan.status != "DELETED",),
    )


@vs_router.post("/scans", response_model=VsScanResponse)
async def create_scan(payload: VsScanCreate, db: AsyncSession = Depends(get_db),
                      user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    prof = (await db.execute(select(VsScanProfile).where(
        VsScanProfile.id == payload.profile_id, VsScanProfile.org_id == org_id))).scalar_one_or_none()
    if not prof:
        raise HTTPException(400, "Unknown profile_id for this org")
    scan = VsScan(
        org_id=org_id, user_id=user.user_id, name=payload.name, profile_id=payload.profile_id,
        asset_ids=payload.asset_ids, schedule_type=payload.schedule_type,
        schedule_value=payload.schedule_value, status="PENDING",
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)
    return scan.to_dict()


@vs_router.get("/scans")
async def list_scans(db: AsyncSession = Depends(get_db),
                     user: CurrentUser = Depends(get_current_user),
                     pp: tuple = Depends(page_params)):
    page, page_size = pp
    org_id = require_org(user.org_id)
    base = select(VsScan).where(VsScan.org_id == org_id, VsScan.status != "DELETED")
    return await paginate(db, base, page, page_size,
                          order_by=(VsScan.created_at.desc(),))


@vs_router.get("/scans/{scan_id}", response_model=VsScanResponse)
async def get_scan(scan_id: str, db: AsyncSession = Depends(get_db),
                   user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    return (await _owned_scan(scan_id, db, org_id)).to_dict()


@vs_router.patch("/scans/{scan_id}", response_model=VsScanResponse)
async def update_scan(scan_id: str, payload: VsScanUpdate, db: AsyncSession = Depends(get_db),
                      user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    scan = await _owned_scan(scan_id, db, org_id)
    for field in ("name", "profile_id", "asset_ids", "schedule_type", "schedule_value"):
        val = getattr(payload, field)
        if val is not None:
            setattr(scan, field, val)
    scan.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(scan)
    return scan.to_dict()


@vs_router.delete("/scans/{scan_id}")
async def delete_scan(scan_id: str, db: AsyncSession = Depends(get_db),
                      user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    scan = await _owned_scan(scan_id, db, org_id)
    scan.status = "DELETED"
    scan.next_run_at = None
    await db.commit()
    return {"deleted": scan_id}


@vs_router.post("/scans/{scan_id}/run", response_model=VsScanResponse)
async def run_scan(scan_id: str, db: AsyncSession = Depends(get_db),
                   user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    scan = await _owned_scan(scan_id, db, org_id)
    if scan.status == "RUNNING":
        raise HTTPException(409, "Scan already running")

    # Targets come ONLY from the existing inventory, and must be ownership-verified.
    asset_ids = scan.asset_ids or []
    if not asset_ids:
        raise HTTPException(400, "Scan has no target assets")
    assets = (await db.execute(select(AssetModel).where(
        AssetModel.id.in_(asset_ids), AssetModel.org_id == org_id))).scalars().all()
    if len(assets) != len(set(asset_ids)):
        raise HTTPException(400, "One or more assets are not in your inventory")
    unverified = [a.name for a in assets if not a.ownership_verified]
    if unverified:
        raise HTTPException(403, f"Ownership not verified for: {', '.join(unverified)}")
    # SSRF / scope guard — reject internal/metadata/private targets.
    for a in assets:
        try:
            validate_scan_target(a.name)
        except ValueError as e:
            raise HTTPException(400, f"Invalid scan target: {e}")

    run = VsScanRun(scan_id=scan.id, org_id=org_id, status="PENDING", triggered_by="manual",
                    started_at=datetime.utcnow())
    db.add(run)
    await db.flush()
    for a in assets:
        db.add(VsScanTarget(scan_run_id=run.id, org_id=org_id, asset_id=a.id,
                            host=a.name, authorized=True, status="pending"))

    prof = (await db.execute(select(VsScanProfile).where(
        VsScanProfile.id == scan.profile_id))).scalar_one_or_none()
    message = build_job_message(run.id, scan.id, org_id, prof.to_dict() if prof else {},
                                [{"asset_id": a.id, "host": a.name} for a in assets])
    scan.status = "RUNNING"
    scan.last_run_at = datetime.utcnow()
    scan.last_run_id = run.id
    await db.commit()

    if not await enqueue_run(message):
        scan.status = "FAILED"
        run.status = "FAILED"
        run.error_message = "failed to enqueue scan job"
        await db.commit()
        raise HTTPException(500, "Unable to enqueue scan job")
    await db.refresh(scan)
    return scan.to_dict()


@vs_router.post("/scans/{scan_id}/pause", response_model=VsScanResponse)
async def pause_scan(scan_id: str, db: AsyncSession = Depends(get_db),
                     user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    scan = await _owned_scan(scan_id, db, org_id)
    scan.status = "PAUSED"
    await db.commit()
    await db.refresh(scan)
    return scan.to_dict()


@vs_router.post("/scans/{scan_id}/resume", response_model=VsScanResponse)
async def resume_scan(scan_id: str, db: AsyncSession = Depends(get_db),
                      user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    scan = await _owned_scan(scan_id, db, org_id)
    scan.status = "PENDING"
    await db.commit()
    await db.refresh(scan)
    return scan.to_dict()


@vs_router.post("/scans/{scan_id}/stop", response_model=VsScanResponse)
async def stop_scan(scan_id: str, db: AsyncSession = Depends(get_db),
                    user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    scan = await _owned_scan(scan_id, db, org_id)
    scan.status = "FAILED"
    scan.next_run_at = None
    await db.commit()
    await db.refresh(scan)
    return scan.to_dict()


@vs_router.get("/scans/{scan_id}/runs")
async def list_runs(scan_id: str, db: AsyncSession = Depends(get_db),
                    user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    await _owned_scan(scan_id, db, org_id)
    rows = (await db.execute(select(VsScanRun).where(
        VsScanRun.scan_id == scan_id, VsScanRun.org_id == org_id)
        .order_by(VsScanRun.created_at.desc()).limit(100))).scalars().all()
    return [r.to_dict() for r in rows]


# ---------------------------------------------------------------------------
# Findings + lifecycle
# ---------------------------------------------------------------------------
@vs_router.get("/findings")
async def list_findings(
    db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user),
    severity: str | None = None, status: str | None = None, asset_id: str | None = None,
    kev: bool | None = None, q: str | None = None,
    pp: tuple = Depends(page_params),
):
    page, page_size = pp
    org_id = require_org(user.org_id)
    query = select(VsFinding).where(VsFinding.org_id == org_id)
    if severity:
        query = query.where(VsFinding.severity == severity)
    if status:
        query = query.where(VsFinding.status == status)
    if asset_id:
        query = query.where(VsFinding.asset_id == asset_id)
    if kev is not None:
        query = query.where(VsFinding.kev.is_(kev))
    if q:
        like = f"%{q}%"
        query = query.where(or_(VsFinding.title.ilike(like), VsFinding.cve_id.ilike(like)))
    return await paginate(db, query, page, page_size,
                          order_by=(VsFinding.composite_risk.desc().nullslast(),
                                    VsFinding.first_detected_at.desc()))


async def _owned_finding(finding_id: str, db: AsyncSession, org_id: str) -> VsFinding:
    return await get_owned_or_404(db, VsFinding, finding_id, org_id, detail="Finding not found")


@vs_router.get("/findings/{finding_id}", response_model=VsFindingResponse)
async def get_finding(finding_id: str, db: AsyncSession = Depends(get_db),
                      user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    return (await _owned_finding(finding_id, db, org_id)).to_dict()


@vs_router.patch("/findings/{finding_id}/status", response_model=VsFindingResponse)
async def transition_finding(finding_id: str, payload: VsFindingStatusUpdate,
                             db: AsyncSession = Depends(get_db),
                             user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    f = await _owned_finding(finding_id, db, org_id)
    target = payload.status
    validate_transition(
        _TRANSITIONS, f.status, target,
        justify_required=_JUSTIFY_REQUIRED, justification=payload.justification,
        illegal_detail=f"Illegal transition {f.status} -> {target}",
        justify_detail=f"Justification required to mark {target}",
    )

    db.add(VsFindingHistory(finding_id=f.id, org_id=org_id, from_status=f.status,
                            to_status=target, actor_user_id=user.user_id,
                            justification=payload.justification))
    prev = f.status
    f.status = target
    if target in _RESOLVED_STATES and prev not in _RESOLVED_STATES:
        f.resolved_at = datetime.utcnow()
    if target == "in_progress":
        f.resolved_at = None
    await db.commit()
    await db.refresh(f)
    return f.to_dict()


@vs_router.patch("/findings/{finding_id}/assign", response_model=VsFindingResponse)
async def assign_finding(finding_id: str, payload: VsFindingAssign,
                         db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    f = await _owned_finding(finding_id, db, org_id)
    f.assigned_to = payload.assigned_to
    await db.commit()
    await db.refresh(f)
    return f.to_dict()


# ---------------------------------------------------------------------------
# Credentials for authenticated scans (secret encrypted at rest, write-only)
# ---------------------------------------------------------------------------
@vs_router.post("/credentials", response_model=VsCredentialResponse)
async def create_credential(payload: VsCredentialCreate, db: AsyncSession = Depends(get_db),
                            user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    from utils.crypto import encrypt_secret
    try:
        ciphertext = encrypt_secret(payload.secret)
    except RuntimeError as e:
        raise HTTPException(503, str(e))   # VS_CRED_KEY not configured
    c = VsCredential(org_id=org_id, name=payload.name, cred_type=payload.cred_type,
                     username=payload.username, secret_ciphertext=ciphertext)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return VsCredentialResponse(id=c.id, name=c.name, cred_type=c.cred_type,
                                username=c.username,
                                created_at=c.created_at.isoformat() if c.created_at else None)


@vs_router.get("/credentials", response_model=list[VsCredentialResponse])
async def list_credentials(db: AsyncSession = Depends(get_db),
                           user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    rows = (await db.execute(select(VsCredential).where(
        VsCredential.org_id == org_id).order_by(VsCredential.created_at.desc()))).scalars().all()
    return [VsCredentialResponse(id=c.id, name=c.name, cred_type=c.cred_type, username=c.username,
                                 created_at=c.created_at.isoformat() if c.created_at else None)
            for c in rows]


@vs_router.delete("/credentials/{credential_id}")
async def delete_credential(credential_id: str, db: AsyncSession = Depends(get_db),
                            user: CurrentUser = Depends(_writer)):
    org_id = require_org(user.org_id)
    c = (await db.execute(select(VsCredential).where(
        VsCredential.id == credential_id, VsCredential.org_id == org_id))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Credential not found")
    await db.delete(c)
    await db.commit()
    return {"deleted": credential_id}


# ---------------------------------------------------------------------------
# CVE intelligence
# ---------------------------------------------------------------------------
@vs_router.get("/cve/{cve_id}", response_model=VsCveResponse)
async def get_cve(cve_id: str, db: AsyncSession = Depends(get_db),
                  user: CurrentUser = Depends(get_current_user)):
    require_org(user.org_id)   # authenticated; CVE intel is shared, not tenant data
    row = (await db.execute(select(VsCveMetadata).where(
        VsCveMetadata.cve_id == cve_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "CVE not in intelligence cache yet")
    return row.to_dict()


# ---------------------------------------------------------------------------
# Verification pass (Domain 7) — re-scan a finding's asset to confirm/close it
# ---------------------------------------------------------------------------
@vs_router.post("/findings/{finding_id}/verify")
async def verify_finding(finding_id: str, db: AsyncSession = Depends(get_db),
                         user: CurrentUser = Depends(_writer)):
    """Enqueue a targeted re-scan of the finding's asset. When results return, a
    re-detected finding is promoted to confidence=confirmed; one not re-detected
    is auto-remediated by the ingest delta — a real multi-signal verification."""
    org_id = require_org(user.org_id)
    f = await _owned_finding(finding_id, db, org_id)
    asset = (await db.execute(select(AssetModel).where(
        AssetModel.id == f.asset_id, AssetModel.org_id == org_id))).scalar_one_or_none()
    if not asset:
        raise HTTPException(400, "Finding's asset is no longer in inventory")
    if not asset.ownership_verified:
        raise HTTPException(403, "Ownership not verified for this asset")
    try:
        validate_scan_target(asset.name)
    except ValueError as e:
        raise HTTPException(400, f"Invalid scan target: {e}")

    # A verify run reuses the finding's originating scan (FK requires a real scan).
    prev_run = (await db.execute(select(VsScanRun).where(
        VsScanRun.id == f.scan_run_id, VsScanRun.org_id == org_id))).scalar_one_or_none()
    if not prev_run:
        raise HTTPException(400, "No originating scan run to verify against")
    run = VsScanRun(scan_id=prev_run.scan_id, org_id=org_id, status="PENDING",
                    triggered_by="rescan", started_at=datetime.utcnow())
    db.add(run)
    await db.flush()
    db.add(VsScanTarget(scan_run_id=run.id, org_id=org_id, asset_id=asset.id,
                        host=asset.name, authorized=True, status="pending"))
    message = build_job_message(run.id, run.scan_id, org_id,
                                {"engines": [f.source_engine or "nuclei"]},
                                [{"asset_id": asset.id, "host": asset.name}])
    await db.commit()
    if not await enqueue_run(message):
        run.status = "FAILED"
        run.error_message = "failed to enqueue verification scan"
        await db.commit()
        raise HTTPException(500, "Unable to enqueue verification scan")
    return {"status": "verification_scan_enqueued", "run_id": run.id}


# ---------------------------------------------------------------------------
# Trends (Domain 8) + Compliance mapping (Domain 9)
# ---------------------------------------------------------------------------
@vs_router.get("/trends")
async def trends(days: int = Query(30, ge=1, le=365), db: AsyncSession = Depends(get_db),
                 user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    rows = (await db.execute(select(VsTrendSnapshot).where(
        VsTrendSnapshot.org_id == org_id).order_by(VsTrendSnapshot.snapshot_date.desc())
        .limit(days))).scalars().all()
    return {"points": [r.to_dict() for r in reversed(rows)]}


@vs_router.get("/compliance")
async def compliance(db: AsyncSession = Depends(get_db),
                     user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    from scoring.vs_compliance import compliance_summary
    rows = (await db.execute(select(VsFinding).where(VsFinding.org_id == org_id))).scalars().all()
    findings = [{"category": f.category, "cwe_ids": None, "cve": f.cve_id,
                 "severity": f.severity, "status": f.status} for f in rows]
    return compliance_summary(findings)


@vs_router.get("/report")
async def vs_report(report_type: str = Query("executive"),
                    format: str = Query("json"),
                    db: AsyncSession = Depends(get_db),
                    user: CurrentUser = Depends(get_current_user)):
    """Generate a VS report from REAL findings (executive/technical/customer/
    compliance) as json/csv/pdf."""
    from fastapi.responses import Response
    org_id = require_org(user.org_id)
    rows = (await db.execute(select(VsFinding).where(VsFinding.org_id == org_id))).scalars().all()
    findings = [f.to_dict() for f in rows]
    content = _build_vs_report_content(findings, report_type)

    if format == "json":
        return content
    if format == "csv":
        import csv as _csv, io as _io
        buf = _io.StringIO()
        w = _csv.writer(buf)
        w.writerow(["title", "severity", "cve", "cvss", "epss", "kev", "composite_risk", "asset_id", "status"])
        for f in findings:
            w.writerow([f.get("title"), f.get("severity"), f.get("cve_id"), f.get("cvss_base"),
                        f.get("epss"), f.get("kev"), f.get("composite_risk"), f.get("asset_id"), f.get("status")])
        return Response(content=buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=vs-{report_type}.csv"})
    if format == "pdf":
        pdf = _render_vs_pdf(f"Vulnerability Report — {report_type.title()}", content)
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f"attachment; filename=vs-{report_type}.pdf"})
    raise HTTPException(400, "format must be json|csv|pdf")


def _build_vs_report_content(findings: list[dict], report_type: str) -> dict:
    """Build VS report content from REAL findings (self-contained, api_service
    path). Empty input -> honest zeros. Compliance uses the local mapping."""
    active = {"open", "confirmed", "in_progress"}
    sev = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    kev = 0
    open_findings = [f for f in findings if f.get("status") in active]
    for f in open_findings:
        s = f.get("severity", "info")
        sev[s] = sev.get(s, 0) + 1
        if f.get("kev"):
            kev += 1
    risks = [f.get("composite_risk") or 0 for f in open_findings]
    avg_risk = round(sum(risks) / len(risks), 1) if risks else 0.0
    top = sorted(open_findings, key=lambda f: f.get("composite_risk") or 0, reverse=True)[:10]

    content: dict = {
        "summary": {
            "total_open": len(open_findings), "critical": sev["critical"], "high": sev["high"],
            "medium": sev["medium"], "low": sev["low"], "info": sev.get("info", 0),
            "kev": kev, "avg_composite_risk": avg_risk,
        },
        "report_type": report_type,
        "top_findings": [{"title": f.get("title"), "severity": f.get("severity"),
                          "cve_id": f.get("cve_id"), "composite_risk": f.get("composite_risk"),
                          "asset_id": f.get("asset_id")} for f in top],
        "sections_included": ["summary", "top_findings"],
    }
    if report_type == "technical":
        content["findings"] = findings
        content["sections_included"].append("findings")
    if report_type == "compliance":
        try:
            from scoring.vs_compliance import compliance_summary
            content["compliance"] = compliance_summary(
                [{"category": f.get("category"), "cwe_ids": None, "cve": f.get("cve_id"),
                  "severity": f.get("severity"), "status": f.get("status")} for f in findings])
            content["sections_included"].append("compliance")
        except Exception:  # noqa: BLE001
            pass   # omit compliance rather than fabricate
    return content


def _render_vs_pdf(title: str, content: dict) -> bytes:
    """Render the VS report content dict to a real PDF (reportlab)."""
    import io as _io
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    buf = _io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4)
    styles = getSampleStyleSheet()
    story = [Paragraph(html.escape(title), styles["Title"]), Spacer(1, 12)]
    summary = content.get("summary", {}) or {}
    for k, v in summary.items():
        story.append(Paragraph(f"<b>{html.escape(str(k))}</b>: {html.escape(str(v))}", styles["Normal"]))
    story.append(Spacer(1, 12))
    for fnd in (content.get("top_findings") or content.get("findings") or [])[:100]:
        line = f"{html.escape(str(fnd.get('severity','')))} — {html.escape(str(fnd.get('title','')))}"
        if fnd.get("cve_id") or fnd.get("cve"):
            line += f" ({html.escape(str(fnd.get('cve_id') or fnd.get('cve')))})"
        story.append(Paragraph(line, styles["Normal"]))
    # Compliance control mapping (audit evidence) — rendered when present.
    comp = content.get("compliance") or {}
    frameworks = comp.get("frameworks") or {}
    if frameworks:
        story.append(Spacer(1, 16))
        story.append(Paragraph("Compliance Control Mapping (open findings)", styles["Heading2"]))
        for fw, data in frameworks.items():
            controls = (data or {}).get("controls") or {}
            if not controls:
                continue
            story.append(Paragraph(f"<b>{html.escape(str(fw))}</b> "
                                   f"({(data or {}).get('open_control_count', 0)} controls impacted)",
                                   styles["Normal"]))
            for ctrl_id, cdata in list(controls.items())[:40]:
                n = (cdata or {}).get("open_findings", 0)
                story.append(Paragraph(f"&nbsp;&nbsp;{html.escape(str(ctrl_id))} — {n} open finding(s)",
                                       styles["Normal"]))
    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Dashboard — REAL aggregates (no hardcoded 4.2 / 87)
# ---------------------------------------------------------------------------
@vs_router.get("/dashboard", response_model=VsDashboardResponse)
async def dashboard(db: AsyncSession = Depends(get_db),
                    user: CurrentUser = Depends(get_current_user)):
    org_id = require_org(user.org_id)
    active = VsFinding.status.notin_(_RESOLVED_STATES)

    async def _count(*conds) -> int:
        return (await db.execute(
            select(func.count()).select_from(VsFinding)
            .where(VsFinding.org_id == org_id, *conds))).scalar() or 0

    total = await _count(active)
    sev = {}
    for s in ("critical", "high", "medium", "low"):
        sev[s] = await _count(active, VsFinding.severity == s)
    kev_count = await _count(active, VsFinding.kev.is_(True))

    # MTTR: mean (resolved_at - first_detected_at) in days over resolved findings.
    mttr_row = (await db.execute(
        select(func.avg(func.extract("epoch", VsFinding.resolved_at - VsFinding.first_detected_at)))
        .where(VsFinding.org_id == org_id, VsFinding.resolved_at.isnot(None)))).scalar()
    avg_mttr_days = round((mttr_row or 0) / 86400.0, 1)

    # Coverage: scanned assets / total org assets.
    total_assets = (await db.execute(select(func.count()).select_from(AssetModel)
                                     .where(AssetModel.org_id == org_id))).scalar() or 0
    scanned_assets = (await db.execute(
        select(func.count(func.distinct(VsScanTarget.asset_id)))
        .where(VsScanTarget.org_id == org_id, VsScanTarget.status == "scanned"))).scalar() or 0
    coverage = int(round(100 * scanned_assets / total_assets)) if total_assets else 0

    sla_breaches = await _count(active, VsFinding.sla_due_at.isnot(None),
                                VsFinding.sla_due_at < datetime.utcnow())

    return VsDashboardResponse(
        total_vulnerabilities=total, critical=sev["critical"], high=sev["high"],
        medium=sev["medium"], low=sev["low"], kev_count=kev_count,
        avg_mttr_days=avg_mttr_days, scan_coverage=coverage, sla_breaches=sla_breaches,
    )

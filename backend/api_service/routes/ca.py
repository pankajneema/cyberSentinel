# routes/ca.py
#
# Compliance & Audit (CA) module API.
#
# Auth: canonical self-hosted stack (utils/auth) + org tenancy
# (utils/tenancy). Auditor portal endpoints use a SEPARATE opaque-token
# dependency (get_current_auditor) — auditor tokens never enter org RBAC and
# are accepted only by /ca/auditor/* routes (read-only + raise-finding).
#
# Integrity: no update endpoint exists for evidence content (append-only,
# DB-trigger enforced); N/A requires justification; every mutation writes the
# hash-chained ca_audit_trail in the same transaction.

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ca.engine import ca_trail, evaluate_org, posture_counts, seed_control_states
from ca.service import _framework_report_data, _report_pdf
from models.ca_models import (
    CaAttestation, CaAudit, CaAuditFinding, CaAuditorGrant, CaCheck, CaControl,
    CaControlCheckMap, CaControlState, CaEvidence, CaEvidenceControlLink,
    CaEvidenceFile, CaFramework, CaGap, CaGapHistory, CaOrgFramework,
    CaPolicy, CaPolicyAck, CaPolicyVersion, CaPostureSnapshot,
)
from schemas.ca_schema import (
    ApplicabilityRequest, AttestationCreate, AuditCreate, AuditFindingUpdate,
    AuditUpdate, AuditorFindingCreate, AuditorGrantCreate, EvidenceRevokeRequest,
    FrameworkEnableRequest, GapAssignRequest, GapTransitionRequest, PolicyCreate,
    PolicyUpdate, PolicyVersionCreate,
)
from utils.crypto import decrypt_secret, encrypt_secret
from utils.database import get_db
from utils.lifecycle import validate_transition
from utils.pagination import page_params as _page_params
from utils.auth import CurrentUser, get_current_user, require_role
from utils.tenancy import require_org

router = APIRouter(prefix="/api/v1/ca", tags=["Compliance & Audit"])

_writer = require_role("owner", "admin", "analyst")
_admin = require_role("owner", "admin")

MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024  # envelope-encrypted into Postgres

# Gap lifecycle — restricted subset of the VS finding state machine
# (routes/vs.py:_TRANSITIONS), same justification discipline.
_GAP_TRANSITIONS: dict[str, set[str]] = {
    "open": {"in_progress", "accepted_risk"},
    "in_progress": {"resolved", "accepted_risk"},
    "resolved": {"verified", "in_progress"},
    "verified": {"closed", "in_progress"},
    "closed": {"in_progress"},
    "accepted_risk": {"in_progress"},
}
_GAP_JUSTIFY_REQUIRED = {"accepted_risk"}
_GAP_RESOLVED = {"resolved", "verified", "closed", "accepted_risk"}


async def _get_org_control(db: AsyncSession, org_id: str, control_id: str) -> tuple[CaControl, CaControlState]:
    control = (await db.execute(select(CaControl).where(CaControl.id == control_id))).scalar_one_or_none()
    if control is None:
        raise HTTPException(404, "Control not found")
    state = (
        await db.execute(
            select(CaControlState).where(
                CaControlState.org_id == org_id, CaControlState.control_id == control_id
            )
        )
    ).scalar_one_or_none()
    if state is None:
        raise HTTPException(404, "Control not enabled for this organization")
    return control, state


# ===========================================================================
# Frameworks
# ===========================================================================
@router.get("/frameworks")
async def list_frameworks(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    org_id = require_org(user.org_id)
    frameworks = (await db.execute(select(CaFramework).order_by(CaFramework.name))).scalars().all()
    enablements = {
        e.framework_id: e
        for e in (
            await db.execute(select(CaOrgFramework).where(CaOrgFramework.org_id == org_id))
        ).scalars().all()
    }
    counts = dict(
        (
            await db.execute(
                select(CaControl.framework_id, func.count(CaControl.id)).group_by(CaControl.framework_id)
            )
        ).all()
    )
    items = []
    for fw in frameworks:
        e = enablements.get(fw.id)
        item = fw.to_dict()
        item["control_count"] = counts.get(fw.id, 0)
        item["enabled"] = bool(e and e.status == "active")
        item["enablement"] = e.to_dict() if e else None
        item["posture"] = (await posture_counts(db, org_id, fw.id)) if e else None
        items.append(item)
    return {"items": items, "total": len(items)}


@router.post("/frameworks/{framework_id}/enable")
async def enable_framework(
    framework_id: str,
    payload: FrameworkEnableRequest,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    fw = (await db.execute(select(CaFramework).where(CaFramework.id == framework_id))).scalar_one_or_none()
    if fw is None:
        raise HTTPException(404, "Framework not found")
    e = (
        await db.execute(
            select(CaOrgFramework).where(
                CaOrgFramework.org_id == org_id, CaOrgFramework.framework_id == framework_id
            )
        )
    ).scalar_one_or_none()
    if e is None:
        e = CaOrgFramework(org_id=org_id, framework_id=framework_id, enabled_by=user.user_id)
        db.add(e)
    e.status = "active"
    e.target_date = payload.target_date
    e.next_eval_at = datetime.utcnow()  # picked up by the next scheduler tick
    seeded = await seed_control_states(db, org_id, framework_id)
    await ca_trail(db, org_id, user.user_id, "framework.enabled", f"framework:{framework_id}",
                   {"key": fw.key, "seeded_controls": seeded})
    # First evaluation runs inline so the user sees an honest (likely low)
    # posture immediately instead of a blank screen.
    result = await evaluate_org(db, org_id, reason="framework_enabled")
    await db.commit()
    return {"enabled": True, "seeded_controls": seeded, "evaluation": result}


@router.post("/frameworks/{framework_id}/pause")
async def pause_framework(
    framework_id: str,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    e = (
        await db.execute(
            select(CaOrgFramework).where(
                CaOrgFramework.org_id == org_id, CaOrgFramework.framework_id == framework_id
            )
        )
    ).scalar_one_or_none()
    if e is None:
        raise HTTPException(404, "Framework not enabled")
    e.status = "paused"
    await ca_trail(db, org_id, user.user_id, "framework.paused", f"framework:{framework_id}")
    await db.commit()
    return {"paused": True}


# ===========================================================================
# Controls
# ===========================================================================
@router.get("/controls")
async def list_controls(
    framework_id: str = Query(...),
    status: str | None = Query(None),
    category: str | None = Query(None),
    page_params: tuple = Depends(_page_params),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    page, page_size = page_params
    stmt = (
        select(CaControl, CaControlState)
        .join(CaControlState, (CaControlState.control_id == CaControl.id) & (CaControlState.org_id == org_id))
        .where(CaControl.framework_id == framework_id)
    )
    if status:
        stmt = stmt.where(CaControlState.status == status)
    if category:
        stmt = stmt.where(CaControl.category == category)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (
        await db.execute(
            stmt.order_by(CaControl.control_ref).limit(page_size).offset((page - 1) * page_size)
        )
    ).all()
    items = [{**c.to_dict(), "state": s.to_dict()} for c, s in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/controls/{control_id}")
async def get_control(
    control_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    control, state = await _get_org_control(db, org_id, control_id)

    maps = (
        await db.execute(
            select(CaControlCheckMap, CaCheck)
            .join(CaCheck, CaCheck.id == CaControlCheckMap.check_id)
            .where(CaControlCheckMap.control_id == control_id)
        )
    ).all()
    check_ids = [c.id for _, c in maps]
    evidence = (
        await db.execute(
            select(CaEvidence)
            .where(
                CaEvidence.org_id == org_id,
                CaEvidence.check_id.in_(check_ids) if check_ids else False,
                CaEvidence.status.in_(("valid", "stale")),
            )
            .order_by(CaEvidence.captured_at.desc())
            .limit(100)
        )
    ).scalars().all() if check_ids else []

    # Related controls in other frameworks that share ≥1 check (evidence reuse).
    related = []
    if check_ids:
        related_rows = (
            await db.execute(
                select(CaControl, CaFramework.key, CaFramework.name)
                .join(CaControlCheckMap, CaControlCheckMap.control_id == CaControl.id)
                .join(CaFramework, CaFramework.id == CaControl.framework_id)
                .where(CaControlCheckMap.check_id.in_(check_ids), CaControl.id != control_id)
                .distinct()
            )
        ).all()
        related = [
            {"id": c.id, "control_ref": c.control_ref, "title": c.title,
             "framework_key": fk, "framework_name": fn}
            for c, fk, fn in related_rows
        ]

    return {
        **control.to_dict(),
        "state": state.to_dict(),
        "checks": [
            {**check.to_dict(), "required": m.required, "rationale": m.rationale}
            for m, check in maps
        ],
        "evidence": [e.to_dict() for e in evidence],
        "related_controls": related,
    }


@router.patch("/controls/{control_id}/applicability")
async def set_applicability(
    control_id: str,
    payload: ApplicabilityRequest,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    control, state = await _get_org_control(db, org_id, control_id)
    now = datetime.utcnow()
    if payload.not_applicable:
        if not payload.justification or len(payload.justification.strip()) < 10:
            raise HTTPException(400, "A justification (min 10 chars) is required to mark a control N/A")
        state.status = "not_applicable"
        state.na_justification = payload.justification.strip()
        state.na_scope = payload.scope
        state.na_set_by = user.user_id
        state.na_set_at = now
        action = "control.na_set"
    else:
        # Un-marking N/A returns the control to unknown; the next evaluation
        # recomputes it from evidence (which never stopped being collected).
        state.status = "unknown"
        state.na_justification = None
        state.na_scope = None
        state.na_set_by = None
        state.na_set_at = None
        action = "control.na_unset"
    await ca_trail(db, org_id, user.user_id, action, f"control:{control_id}",
                   {"control_ref": control.control_ref, "justification": payload.justification,
                    "scope": payload.scope})
    if not payload.not_applicable:
        await evaluate_org(db, org_id, reason="na_unset")
    await db.commit()
    return {"status": state.status}


# ===========================================================================
# Evidence
# ===========================================================================
@router.get("/evidence")
async def list_evidence(
    check_id: str | None = Query(None),
    status: str | None = Query(None),
    collection: str | None = Query(None),
    page_params: tuple = Depends(_page_params),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    page, page_size = page_params
    stmt = select(CaEvidence).where(CaEvidence.org_id == org_id)
    if check_id:
        stmt = stmt.where(CaEvidence.check_id == check_id)
    if status:
        stmt = stmt.where(CaEvidence.status == status)
    if collection:
        stmt = stmt.where(CaEvidence.collection == collection)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (
        await db.execute(
            stmt.order_by(CaEvidence.captured_at.desc()).limit(page_size).offset((page - 1) * page_size)
        )
    ).scalars().all()
    return {"items": [e.to_dict() for e in rows], "total": total, "page": page, "page_size": page_size}


@router.post("/evidence")
async def upload_manual_evidence(
    summary: str = Form(...),
    check_id: str | None = Form(None),
    control_id: str | None = Form(None),
    valid_days: int = Form(180),
    file: UploadFile | None = File(None),
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    """Manual evidence upload. ALWAYS recorded as collection='manual' — manual
    evidence can never masquerade as system-collected (integrity rule).

    Attach to a manual CHECK (check_id) or directly to a CONTROL with no
    automated coverage (control_id). Either way, evidence only counts as
    'pass' when a real document is attached — a bare sentence satisfies
    nothing (anti-inflation rule)."""
    org_id = require_org(user.org_id)
    if len(summary.strip()) < 3:
        raise HTTPException(400, "Summary is required")
    if not 1 <= valid_days <= 1095:
        raise HTTPException(400, "valid_days must be between 1 and 1095")
    if check_id and control_id:
        raise HTTPException(400, "Provide check_id OR control_id, not both")
    if (check_id or control_id) and file is None:
        raise HTTPException(
            400, "A document must be attached for evidence intended to satisfy a check or control"
        )

    check = None
    if check_id:
        check = (await db.execute(select(CaCheck).where(CaCheck.id == check_id))).scalar_one_or_none()
        if check is None:
            raise HTTPException(404, "Check not found")
    target_control = None
    if control_id:
        target_control = (
            await db.execute(select(CaControl).where(CaControl.id == control_id))
        ).scalar_one_or_none()
        if target_control is None:
            raise HTTPException(404, "Control not found")

    file_row = None
    file_meta = {}
    if file is not None:
        blob = await file.read()
        if len(blob) > MAX_EVIDENCE_FILE_BYTES:
            raise HTTPException(400, "File exceeds the 10 MB evidence limit")
        if not blob:
            raise HTTPException(400, "Uploaded file is empty")
        digest = hashlib.sha256(blob).hexdigest()
        file_row = CaEvidenceFile(
            org_id=org_id,
            filename=file.filename or "evidence.bin",
            content_type=file.content_type,
            size_bytes=len(blob),
            sha256=digest,
            # Envelope-encrypted at rest (same Fernet pattern as vs_credentials).
            ciphertext=encrypt_secret(base64.b64encode(blob).decode()),
            uploaded_by=user.user_id,
        )
        db.add(file_row)
        await db.flush()
        file_meta = {"filename": file_row.filename, "sha256": digest, "size_bytes": len(blob)}

    now = datetime.utcnow()
    content = {"summary": summary.strip(), **file_meta}
    source_ref = {"table": "ca_evidence_files", "ids": [file_row.id] if file_row else []}
    ev = CaEvidence(
        org_id=org_id,
        check_id=check_id,
        collection="manual",
        source_type="manual_upload",
        source_ref=source_ref,
        summary=summary.strip(),
        content=content,
        content_hash=hashlib.sha256(
            (str(sorted(content.items())) + str(source_ref)).encode()
        ).hexdigest(),
        # 'pass' only for targeted, document-backed evidence (enforced above).
        result="pass" if (check_id or control_id) else None,
        captured_at=now,
        valid_until=now + timedelta(days=valid_days),
        status="valid",
        uploaded_by=user.user_id,
        file_id=file_row.id if file_row else None,
    )
    db.add(ev)
    await db.flush()

    if check:
        # Materialize links so control views show the manual evidence.
        control_ids = (
            await db.execute(
                select(CaControlCheckMap.control_id).where(CaControlCheckMap.check_id == check.id)
            )
        ).scalars().all()
        for cid in control_ids:
            db.add(CaEvidenceControlLink(org_id=org_id, evidence_id=ev.id, control_id=cid))
    elif target_control:
        db.add(CaEvidenceControlLink(org_id=org_id, evidence_id=ev.id, control_id=target_control.id))

    await ca_trail(db, org_id, user.user_id, "evidence.uploaded", f"evidence:{ev.id}",
                   {"check_id": check_id, "control_id": control_id, **file_meta})
    if check or target_control:
        await evaluate_org(db, org_id, reason="manual_evidence")
    await db.commit()
    return ev.to_dict()


@router.post("/evidence/{evidence_id}/revoke")
async def revoke_evidence(
    evidence_id: str,
    payload: EvidenceRevokeRequest,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    """The only lifecycle mutation allowed on evidence — never deletion."""
    org_id = require_org(user.org_id)
    ev = (
        await db.execute(
            select(CaEvidence).where(CaEvidence.id == evidence_id, CaEvidence.org_id == org_id)
        )
    ).scalar_one_or_none()
    if ev is None:
        raise HTTPException(404, "Evidence not found")
    if ev.status == "revoked":
        raise HTTPException(409, "Evidence already revoked")
    ev.status = "revoked"
    ev.revoke_justification = payload.justification
    await ca_trail(db, org_id, user.user_id, "evidence.revoked", f"evidence:{evidence_id}",
                   {"justification": payload.justification})
    await evaluate_org(db, org_id, reason="evidence_revoked")
    await db.commit()
    return {"revoked": True}


@router.get("/evidence/{evidence_id}/file")
async def download_evidence_file(
    evidence_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    ev = (
        await db.execute(
            select(CaEvidence).where(CaEvidence.id == evidence_id, CaEvidence.org_id == org_id)
        )
    ).scalar_one_or_none()
    if ev is None or not ev.file_id:
        raise HTTPException(404, "Evidence file not found")
    f = (
        await db.execute(
            select(CaEvidenceFile).where(CaEvidenceFile.id == ev.file_id, CaEvidenceFile.org_id == org_id)
        )
    ).scalar_one_or_none()
    if f is None:
        raise HTTPException(404, "Evidence file not found")
    blob = base64.b64decode(decrypt_secret(f.ciphertext))
    if hashlib.sha256(blob).hexdigest() != f.sha256:
        raise HTTPException(500, "Evidence file failed integrity verification")
    await ca_trail(db, org_id, user.user_id, "evidence.file_downloaded", f"evidence:{evidence_id}")
    await db.commit()
    return Response(
        content=blob,
        media_type=f.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{f.filename}"'},
    )


# ===========================================================================
# Gaps & remediation
# ===========================================================================
@router.get("/gaps")
async def list_gaps(
    status: str | None = Query(None),
    severity: str | None = Query(None),
    page_params: tuple = Depends(_page_params),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    page, page_size = page_params
    stmt = (
        select(CaGap, CaControl.control_ref, CaControl.title, CaControl.framework_id)
        .join(CaControl, CaControl.id == CaGap.control_id)
        .where(CaGap.org_id == org_id)
    )
    if status:
        stmt = stmt.where(CaGap.status == status)
    if severity:
        stmt = stmt.where(CaGap.severity == severity)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (
        await db.execute(
            stmt.order_by(CaGap.first_detected_at.desc()).limit(page_size).offset((page - 1) * page_size)
        )
    ).all()
    items = [
        {**g.to_dict(), "control_ref": ref, "control_title": title, "framework_id": fw_id}
        for g, ref, title, fw_id in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/gaps/summary")
async def gaps_summary(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    org_id = require_org(user.org_id)
    by_status = dict(
        (
            await db.execute(
                select(CaGap.status, func.count(CaGap.id))
                .where(CaGap.org_id == org_id)
                .group_by(CaGap.status)
            )
        ).all()
    )
    by_severity = dict(
        (
            await db.execute(
                select(CaGap.severity, func.count(CaGap.id))
                .where(CaGap.org_id == org_id, CaGap.status.in_(("open", "in_progress")))
                .group_by(CaGap.severity)
            )
        ).all()
    )
    overdue = (
        await db.execute(
            select(func.count(CaGap.id)).where(
                CaGap.org_id == org_id,
                CaGap.status.in_(("open", "in_progress")),
                CaGap.sla_due_at < datetime.utcnow(),
            )
        )
    ).scalar() or 0
    return {"by_status": by_status, "open_by_severity": by_severity, "sla_breaches": overdue}


@router.patch("/gaps/{gap_id}/status")
async def transition_gap(
    gap_id: str,
    payload: GapTransitionRequest,
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    gap = (
        await db.execute(select(CaGap).where(CaGap.id == gap_id, CaGap.org_id == org_id))
    ).scalar_one_or_none()
    if gap is None:
        raise HTTPException(404, "Gap not found")
    validate_transition(
        _GAP_TRANSITIONS, gap.status, payload.status,
        justify_required=_GAP_JUSTIFY_REQUIRED, justification=payload.justification,
        illegal_detail=f"Illegal transition {gap.status} → {payload.status}",
        justify_detail=f"Justification required for '{payload.status}'",
    )
    db.add(CaGapHistory(
        gap_id=gap.id, org_id=org_id, from_status=gap.status, to_status=payload.status,
        actor_user_id=user.user_id, justification=payload.justification,
    ))
    old = gap.status
    gap.status = payload.status
    if payload.status in _GAP_RESOLVED:
        gap.resolved_at = datetime.utcnow()
    elif old in _GAP_RESOLVED:
        gap.resolved_at = None
    await ca_trail(db, org_id, user.user_id, "gap.transition", f"gap:{gap_id}",
                   {"from": old, "to": payload.status, "justification": payload.justification})
    await db.commit()
    return gap.to_dict()


@router.patch("/gaps/{gap_id}/assign")
async def assign_gap(
    gap_id: str,
    payload: GapAssignRequest,
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    gap = (
        await db.execute(select(CaGap).where(CaGap.id == gap_id, CaGap.org_id == org_id))
    ).scalar_one_or_none()
    if gap is None:
        raise HTTPException(404, "Gap not found")
    gap.assigned_to = payload.assigned_to
    await ca_trail(db, org_id, user.user_id, "gap.assigned", f"gap:{gap_id}",
                   {"assigned_to": payload.assigned_to})
    await db.commit()
    return gap.to_dict()


@router.get("/gaps/{gap_id}/history")
async def gap_history(
    gap_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    rows = (
        await db.execute(
            select(CaGapHistory)
            .where(CaGapHistory.gap_id == gap_id, CaGapHistory.org_id == org_id)
            .order_by(CaGapHistory.at.asc())
        )
    ).scalars().all()
    return {
        "items": [
            {"from_status": h.from_status, "to_status": h.to_status,
             "actor_user_id": h.actor_user_id, "justification": h.justification,
             "at": h.at.isoformat() if h.at else None}
            for h in rows
        ]
    }


# ===========================================================================
# Policies
# ===========================================================================
@router.get("/policies/templates")
async def list_policy_templates(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    require_org(user.org_id)
    rows = (
        await db.execute(
            select(CaPolicy).where(CaPolicy.org_id.is_(None), CaPolicy.status == "template")
        )
    ).scalars().all()
    return {"items": [p.to_dict() for p in rows]}


@router.get("/policies")
async def list_policies(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    org_id = require_org(user.org_id)
    rows = (
        await db.execute(
            select(CaPolicy).where(CaPolicy.org_id == org_id).order_by(CaPolicy.created_at.desc())
        )
    ).scalars().all()
    items = []
    for p in rows:
        acks = 0
        if p.current_version_id:
            acks = (
                await db.execute(
                    select(func.count(CaPolicyAck.id)).where(
                        CaPolicyAck.policy_version_id == p.current_version_id
                    )
                )
            ).scalar() or 0
        items.append({**p.to_dict(), "ack_count": acks})
    return {"items": items, "total": len(items)}


@router.post("/policies")
async def create_policy(
    payload: PolicyCreate,
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    policy = CaPolicy(
        org_id=org_id,
        key=payload.key,
        title=payload.title,
        description=payload.description,
        status="draft",
        owner_user_id=user.user_id,
        review_frequency_days=payload.review_frequency_days,
    )
    db.add(policy)
    await db.flush()

    if payload.from_template_id:
        tpl = (
            await db.execute(
                select(CaPolicy).where(
                    CaPolicy.id == payload.from_template_id,
                    CaPolicy.org_id.is_(None),
                    CaPolicy.status == "template",
                )
            )
        ).scalar_one_or_none()
        if tpl is None:
            raise HTTPException(404, "Template not found")
        policy.key = policy.key or tpl.key
        if not payload.description:
            policy.description = tpl.description
        tpl_ver = None
        if tpl.current_version_id:
            tpl_ver = (
                await db.execute(
                    select(CaPolicyVersion).where(CaPolicyVersion.id == tpl.current_version_id)
                )
            ).scalar_one_or_none()
        if tpl_ver:
            # Cloned as a DRAFT version-0 body; org must publish explicitly.
            db.add(CaPolicyVersion(
                policy_id=policy.id, version=1, body_md=tpl_ver.body_md,
                sha256=tpl_ver.sha256, published_by=None,
            ))
            await db.flush()

    await ca_trail(db, org_id, user.user_id, "policy.created", f"policy:{policy.id}",
                   {"title": policy.title, "from_template": payload.from_template_id})
    await db.commit()
    return policy.to_dict()


@router.get("/policies/{policy_id}")
async def get_policy(
    policy_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    p = (
        await db.execute(
            select(CaPolicy).where(
                CaPolicy.id == policy_id,
                (CaPolicy.org_id == org_id) | (CaPolicy.org_id.is_(None)),
            )
        )
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Policy not found")
    versions = (
        await db.execute(
            select(CaPolicyVersion)
            .where(CaPolicyVersion.policy_id == policy_id)
            .order_by(CaPolicyVersion.version.desc())
        )
    ).scalars().all()
    acked_by = []
    if p.current_version_id:
        acked_by = (
            await db.execute(
                select(CaPolicyAck.member_user_id, CaPolicyAck.acked_at).where(
                    CaPolicyAck.policy_version_id == p.current_version_id
                )
            )
        ).all()
    return {
        **p.to_dict(),
        "versions": [v.to_dict() for v in versions],
        "acks": [{"member_user_id": m, "acked_at": a.isoformat() if a else None} for m, a in acked_by],
    }


@router.patch("/policies/{policy_id}")
async def update_policy(
    policy_id: str,
    payload: PolicyUpdate,
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    p = (
        await db.execute(
            select(CaPolicy).where(CaPolicy.id == policy_id, CaPolicy.org_id == org_id)
        )
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Policy not found")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("status") == "template":
        raise HTTPException(400, "Org policies cannot be turned into templates")
    for k, v in changes.items():
        setattr(p, k, v)
    if changes.get("status") == "active" and not p.current_version_id:
        raise HTTPException(409, "Publish a version before activating the policy")
    await ca_trail(db, org_id, user.user_id, "policy.updated", f"policy:{policy_id}", changes)
    await evaluate_org(db, org_id, reason="policy_changed")
    await db.commit()
    return p.to_dict()


@router.post("/policies/{policy_id}/versions")
async def publish_policy_version(
    policy_id: str,
    payload: PolicyVersionCreate,
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    p = (
        await db.execute(
            select(CaPolicy).where(CaPolicy.id == policy_id, CaPolicy.org_id == org_id)
        )
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Policy not found")
    last = (
        await db.execute(
            select(func.max(CaPolicyVersion.version)).where(CaPolicyVersion.policy_id == policy_id)
        )
    ).scalar() or 0
    ver = CaPolicyVersion(
        policy_id=policy_id,
        version=last + 1,
        body_md=payload.body_md,
        sha256=hashlib.sha256(payload.body_md.encode()).hexdigest(),
        published_by=user.user_id,
    )
    db.add(ver)
    await db.flush()
    p.current_version_id = ver.id
    p.next_review_at = datetime.utcnow() + timedelta(days=p.review_frequency_days)
    await ca_trail(db, org_id, user.user_id, "policy.version_published", f"policy:{policy_id}",
                   {"version": ver.version, "sha256": ver.sha256})
    await evaluate_org(db, org_id, reason="policy_published")
    await db.commit()
    return ver.to_dict()


@router.post("/policies/{policy_id}/ack")
async def acknowledge_policy(
    policy_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    p = (
        await db.execute(
            select(CaPolicy).where(CaPolicy.id == policy_id, CaPolicy.org_id == org_id)
        )
    ).scalar_one_or_none()
    if p is None or not p.current_version_id:
        raise HTTPException(404, "Policy (or published version) not found")
    existing = (
        await db.execute(
            select(CaPolicyAck).where(
                CaPolicyAck.policy_version_id == p.current_version_id,
                CaPolicyAck.member_user_id == user.user_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(CaPolicyAck(org_id=org_id, policy_version_id=p.current_version_id,
                           member_user_id=user.user_id))
        await ca_trail(db, org_id, user.user_id, "policy.acknowledged", f"policy:{policy_id}",
                       {"version_id": p.current_version_id})
        await db.commit()
    return {"acknowledged": True}


# ===========================================================================
# Posture & evaluation
# ===========================================================================
@router.get("/posture")
async def get_posture(
    framework_id: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    stmt = select(CaOrgFramework, CaFramework).join(
        CaFramework, CaFramework.id == CaOrgFramework.framework_id
    ).where(CaOrgFramework.org_id == org_id, CaOrgFramework.status == "active")
    if framework_id:
        stmt = stmt.where(CaOrgFramework.framework_id == framework_id)
    rows = (await db.execute(stmt)).all()
    items = []
    for e, fw in rows:
        counts = await posture_counts(db, org_id, fw.id)
        items.append({
            "framework_id": fw.id, "framework_key": fw.key, "framework_name": fw.name,
            "counts": {k: counts[k] for k in
                       ("satisfied", "partial", "gap", "unknown", "not_applicable", "applicable", "total")},
            "score": counts["score"],
        })
    return {"items": items}


@router.get("/posture/trend")
async def posture_trend(
    framework_id: str = Query(...),
    days: int = Query(30, ge=1, le=365),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = (
        await db.execute(
            select(CaPostureSnapshot)
            .where(
                CaPostureSnapshot.org_id == org_id,
                CaPostureSnapshot.framework_id == framework_id,
                CaPostureSnapshot.snapshot_date >= since,
            )
            .order_by(CaPostureSnapshot.snapshot_date.asc())
        )
    ).scalars().all()
    return {"items": [s.to_dict() for s in rows]}


@router.post("/evaluate")
async def run_evaluation(
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    result = await evaluate_org(db, org_id, reason="manual")
    await ca_trail(db, org_id, user.user_id, "evaluation.manual", None,
                   {"changes": result.get("changes", [])})
    await db.commit()
    return result


@router.get("/trail")
async def list_trail(
    page_params: tuple = Depends(_page_params),
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    from models.ca_models import CaAuditTrail
    org_id = require_org(user.org_id)
    page, page_size = page_params
    stmt = select(CaAuditTrail).where(CaAuditTrail.org_id == org_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (
        await db.execute(
            stmt.order_by(CaAuditTrail.at.desc()).limit(page_size).offset((page - 1) * page_size)
        )
    ).scalars().all()
    return {"items": [t.to_dict() for t in rows], "total": total, "page": page, "page_size": page_size}


# ===========================================================================
# Audits & auditor grants (org side)
# ===========================================================================
@router.get("/audits")
async def list_audits(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    org_id = require_org(user.org_id)
    rows = (
        await db.execute(
            select(CaAudit).where(CaAudit.org_id == org_id).order_by(CaAudit.created_at.desc())
        )
    ).scalars().all()
    return {"items": [a.to_dict() for a in rows]}


@router.post("/audits")
async def create_audit(
    payload: AuditCreate,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    fw = (
        await db.execute(select(CaFramework).where(CaFramework.id == payload.framework_id))
    ).scalar_one_or_none()
    if fw is None:
        raise HTTPException(404, "Framework not found")
    audit = CaAudit(
        org_id=org_id, framework_id=payload.framework_id, name=payload.name,
        audit_firm=payload.audit_firm, period_start=payload.period_start,
        period_end=payload.period_end, scope=payload.scope, created_by=user.user_id,
    )
    db.add(audit)
    await db.flush()
    await ca_trail(db, org_id, user.user_id, "audit.created", f"audit:{audit.id}",
                   {"name": payload.name, "framework": fw.key})
    await db.commit()
    return audit.to_dict()


@router.patch("/audits/{audit_id}")
async def update_audit(
    audit_id: str,
    payload: AuditUpdate,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    audit = (
        await db.execute(select(CaAudit).where(CaAudit.id == audit_id, CaAudit.org_id == org_id))
    ).scalar_one_or_none()
    if audit is None:
        raise HTTPException(404, "Audit not found")
    changes = payload.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(audit, k, v)
    await ca_trail(db, org_id, user.user_id, "audit.updated", f"audit:{audit_id}", changes)
    await db.commit()
    return audit.to_dict()


@router.get("/audits/{audit_id}/grants")
async def list_grants(
    audit_id: str,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    rows = (
        await db.execute(
            select(CaAuditorGrant).where(
                CaAuditorGrant.audit_id == audit_id, CaAuditorGrant.org_id == org_id
            )
        )
    ).scalars().all()
    return {"items": [g.to_dict() for g in rows]}


@router.post("/audits/{audit_id}/grants")
async def create_grant(
    audit_id: str,
    payload: AuditorGrantCreate,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    """Creates a scoped auditor token. The plaintext token is returned ONCE and
    stored only as a sha256 hash. Leaked token blast radius = read access to
    this audit's in-scope evidence until expiry."""
    org_id = require_org(user.org_id)
    audit = (
        await db.execute(select(CaAudit).where(CaAudit.id == audit_id, CaAudit.org_id == org_id))
    ).scalar_one_or_none()
    if audit is None:
        raise HTTPException(404, "Audit not found")
    token = secrets.token_urlsafe(32)
    grant = CaAuditorGrant(
        org_id=org_id,
        audit_id=audit_id,
        auditor_email=payload.auditor_email.strip().lower(),
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=datetime.utcnow() + timedelta(days=payload.expires_in_days),
        created_by=user.user_id,
    )
    db.add(grant)
    await db.flush()
    await ca_trail(db, org_id, user.user_id, "auditor.grant_created", f"grant:{grant.id}",
                   {"audit_id": audit_id, "auditor_email": grant.auditor_email,
                    "expires_at": grant.expires_at.isoformat()})
    await db.commit()
    return {"grant": grant.to_dict(), "token": token}


@router.delete("/audits/{audit_id}/grants/{grant_id}")
async def revoke_grant(
    audit_id: str,
    grant_id: str,
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    grant = (
        await db.execute(
            select(CaAuditorGrant).where(
                CaAuditorGrant.id == grant_id,
                CaAuditorGrant.audit_id == audit_id,
                CaAuditorGrant.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if grant is None:
        raise HTTPException(404, "Grant not found")
    grant.revoked_at = datetime.utcnow()
    await ca_trail(db, org_id, user.user_id, "auditor.grant_revoked", f"grant:{grant_id}")
    await db.commit()
    return {"revoked": True}


@router.get("/audits/{audit_id}/findings")
async def list_audit_findings(
    audit_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    rows = (
        await db.execute(
            select(CaAuditFinding).where(
                CaAuditFinding.audit_id == audit_id, CaAuditFinding.org_id == org_id
            )
        )
    ).scalars().all()
    return {"items": [f.to_dict() for f in rows]}


@router.patch("/audits/{audit_id}/findings/{finding_id}")
async def update_audit_finding(
    audit_id: str,
    finding_id: str,
    payload: AuditFindingUpdate,
    user: CurrentUser = Depends(_writer),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    f = (
        await db.execute(
            select(CaAuditFinding).where(
                CaAuditFinding.id == finding_id,
                CaAuditFinding.audit_id == audit_id,
                CaAuditFinding.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if f is None:
        raise HTTPException(404, "Audit finding not found")
    if payload.status:
        f.status = payload.status
        await ca_trail(db, org_id, user.user_id, "audit_finding.updated", f"audit_finding:{finding_id}",
                       {"status": payload.status})
    await db.commit()
    return f.to_dict()


@router.post("/audits/{audit_id}/attestations")
async def upload_attestation(
    audit_id: str,
    kind: str | None = Form(None),
    valid_from: str | None = Form(None),
    valid_until: str | None = Form(None),
    file: UploadFile = File(...),
    user: CurrentUser = Depends(_admin),
    db: AsyncSession = Depends(get_db),
):
    org_id = require_org(user.org_id)
    audit = (
        await db.execute(select(CaAudit).where(CaAudit.id == audit_id, CaAudit.org_id == org_id))
    ).scalar_one_or_none()
    if audit is None:
        raise HTTPException(404, "Audit not found")
    blob = await file.read()
    if not blob or len(blob) > MAX_EVIDENCE_FILE_BYTES:
        raise HTTPException(400, "File is empty or exceeds the 10 MB limit")
    f = CaEvidenceFile(
        org_id=org_id, filename=file.filename or "attestation.bin",
        content_type=file.content_type, size_bytes=len(blob),
        sha256=hashlib.sha256(blob).hexdigest(),
        ciphertext=encrypt_secret(base64.b64encode(blob).decode()),
        uploaded_by=user.user_id,
    )
    db.add(f)
    await db.flush()

    def _parse_dt(v):
        return datetime.fromisoformat(v) if v else None

    att = CaAttestation(
        audit_id=audit_id, org_id=org_id, kind=kind,
        valid_from=_parse_dt(valid_from), valid_until=_parse_dt(valid_until), file_id=f.id,
    )
    db.add(att)
    await db.flush()
    await ca_trail(db, org_id, user.user_id, "attestation.uploaded", f"attestation:{att.id}",
                   {"audit_id": audit_id, "kind": kind, "sha256": f.sha256})
    await db.commit()
    return att.to_dict()


# ===========================================================================
# Reporting & audit-readiness export
# ===========================================================================
@router.get("/reports")
async def generate_report(
    framework_id: str | None = Query(None),
    format: str = Query("json", pattern="^(json|pdf)$"),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Executive + control-by-control report from LIVE control states and valid
    evidence only. One framework (framework_id) or all enabled frameworks."""
    org_id = require_org(user.org_id)
    stmt = (
        select(CaFramework)
        .join(CaOrgFramework, (CaOrgFramework.framework_id == CaFramework.id)
              & (CaOrgFramework.org_id == org_id)
              & (CaOrgFramework.status == "active"))
    )
    if framework_id:
        stmt = stmt.where(CaFramework.id == framework_id)
    frameworks = (await db.execute(stmt)).scalars().all()
    if not frameworks:
        raise HTTPException(404, "No enabled framework matches")
    reports = [await _framework_report_data(db, org_id, fw) for fw in frameworks]
    await ca_trail(db, org_id, user.user_id, "report.generated", None,
                   {"frameworks": [f.key for f in frameworks], "format": format})
    await db.commit()
    if format == "pdf":
        pdf = _report_pdf(reports)
        name = f"compliance-{frameworks[0].key if framework_id else 'all'}-{datetime.utcnow():%Y%m%d}.pdf"
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})
    return {"reports": reports}


# ===========================================================================
# Auditor portal — separate auth plane, read-only + raise-finding
# ===========================================================================
_auditor_bearer = HTTPBearer(auto_error=False)


async def get_current_auditor(
    creds: HTTPAuthorizationCredentials | None = Depends(_auditor_bearer),
    db: AsyncSession = Depends(get_db),
) -> CaAuditorGrant:
    """Opaque-token dependency for /ca/auditor/*. Never accepts regular access JWTs;
    org endpoints never accept auditor tokens. Every request re-checks expiry
    and revocation."""
    if creds is None or not creds.credentials:
        raise HTTPException(401, "Auditor token required")
    token_hash = hashlib.sha256(creds.credentials.encode()).hexdigest()
    grant = (
        await db.execute(
            select(CaAuditorGrant).where(CaAuditorGrant.token_hash == token_hash)
        )
    ).scalar_one_or_none()
    now = datetime.utcnow()
    if grant is None or grant.revoked_at is not None or grant.expires_at < now:
        raise HTTPException(401, "Invalid, expired, or revoked auditor token")
    grant.last_access_at = now
    return grant


async def _audit_scope_control_ids(db: AsyncSession, grant: CaAuditorGrant) -> list[str]:
    audit = (
        await db.execute(select(CaAudit).where(CaAudit.id == grant.audit_id))
    ).scalar_one()
    stmt = select(CaControl.id).where(CaControl.framework_id == audit.framework_id)
    scope = audit.scope or {}
    if scope.get("control_ids"):
        stmt = stmt.where(CaControl.id.in_(scope["control_ids"]))
    elif scope.get("categories"):
        stmt = stmt.where(CaControl.category.in_(scope["categories"]))
    return (await db.execute(stmt)).scalars().all()


@router.get("/auditor/me")
async def auditor_me(
    grant: CaAuditorGrant = Depends(get_current_auditor),
    db: AsyncSession = Depends(get_db),
):
    audit = (await db.execute(select(CaAudit).where(CaAudit.id == grant.audit_id))).scalar_one()
    fw = (await db.execute(select(CaFramework).where(CaFramework.id == audit.framework_id))).scalar_one()
    await db.commit()  # persist last_access_at set by the dependency
    return {
        "auditor_email": grant.auditor_email,
        "expires_at": grant.expires_at.isoformat(),
        "audit": audit.to_dict(),
        "framework": fw.to_dict(),
    }


@router.get("/auditor/controls")
async def auditor_controls(
    grant: CaAuditorGrant = Depends(get_current_auditor),
    db: AsyncSession = Depends(get_db),
):
    control_ids = await _audit_scope_control_ids(db, grant)
    rows = (
        await db.execute(
            select(CaControl, CaControlState)
            .join(CaControlState, (CaControlState.control_id == CaControl.id)
                  & (CaControlState.org_id == grant.org_id))
            .where(CaControl.id.in_(control_ids))
            .order_by(CaControl.control_ref)
        )
    ).all()
    await ca_trail(db, grant.org_id, f"auditor:{grant.id}", "auditor.controls_viewed",
                   f"audit:{grant.audit_id}", {"count": len(rows)})
    await db.commit()
    return {"items": [{**c.to_dict(), "state": s.to_dict()} for c, s in rows]}


@router.get("/auditor/controls/{control_id}")
async def auditor_control_detail(
    control_id: str,
    grant: CaAuditorGrant = Depends(get_current_auditor),
    db: AsyncSession = Depends(get_db),
):
    control_ids = await _audit_scope_control_ids(db, grant)
    if control_id not in control_ids:
        raise HTTPException(404, "Control not found")  # 404 not 403 — don't leak existence
    control = (await db.execute(select(CaControl).where(CaControl.id == control_id))).scalar_one()
    state = (
        await db.execute(
            select(CaControlState).where(
                CaControlState.org_id == grant.org_id, CaControlState.control_id == control_id
            )
        )
    ).scalar_one_or_none()
    ev_rows = (
        await db.execute(
            select(CaEvidence)
            .join(CaEvidenceControlLink, CaEvidenceControlLink.evidence_id == CaEvidence.id)
            .where(
                CaEvidenceControlLink.control_id == control_id,
                CaEvidence.org_id == grant.org_id,
                CaEvidence.status.in_(("valid", "stale")),
            )
            .order_by(CaEvidence.captured_at.desc())
            .limit(50)
        )
    ).scalars().all()
    await ca_trail(db, grant.org_id, f"auditor:{grant.id}", "auditor.evidence_viewed",
                   f"control:{control_id}", {"evidence_count": len(ev_rows)})
    await db.commit()
    return {
        **control.to_dict(),
        "state": state.to_dict() if state else None,
        "evidence": [e.to_dict() for e in ev_rows],
    }


@router.get("/auditor/evidence/{evidence_id}/file")
async def auditor_evidence_file(
    evidence_id: str,
    grant: CaAuditorGrant = Depends(get_current_auditor),
    db: AsyncSession = Depends(get_db),
):
    control_ids = await _audit_scope_control_ids(db, grant)
    linked = (
        await db.execute(
            select(CaEvidenceControlLink.id).where(
                CaEvidenceControlLink.evidence_id == evidence_id,
                CaEvidenceControlLink.control_id.in_(control_ids),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if linked is None:
        raise HTTPException(404, "Evidence not found")
    ev = (
        await db.execute(
            select(CaEvidence).where(CaEvidence.id == evidence_id, CaEvidence.org_id == grant.org_id)
        )
    ).scalar_one_or_none()
    if ev is None or not ev.file_id:
        raise HTTPException(404, "Evidence file not found")
    f = (
        await db.execute(select(CaEvidenceFile).where(CaEvidenceFile.id == ev.file_id))
    ).scalar_one_or_none()
    if f is None:
        raise HTTPException(404, "Evidence file not found")
    blob = base64.b64decode(decrypt_secret(f.ciphertext))
    if hashlib.sha256(blob).hexdigest() != f.sha256:
        raise HTTPException(500, "Evidence file failed integrity verification")
    await ca_trail(db, grant.org_id, f"auditor:{grant.id}", "auditor.evidence_file_downloaded",
                   f"evidence:{evidence_id}")
    await db.commit()
    return Response(
        content=blob,
        media_type=f.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{f.filename}"'},
    )


@router.post("/auditor/findings")
async def auditor_raise_finding(
    payload: AuditorFindingCreate,
    grant: CaAuditorGrant = Depends(get_current_auditor),
    db: AsyncSession = Depends(get_db),
):
    """The auditor's single write: raise a finding on an in-scope control."""
    if payload.control_id:
        control_ids = await _audit_scope_control_ids(db, grant)
        if payload.control_id not in control_ids:
            raise HTTPException(404, "Control not found")
    f = CaAuditFinding(
        audit_id=grant.audit_id, org_id=grant.org_id, control_id=payload.control_id,
        title=payload.title, description=payload.description, severity=payload.severity,
        raised_by_grant_id=grant.id,
    )
    db.add(f)
    await db.flush()
    await ca_trail(db, grant.org_id, f"auditor:{grant.id}", "auditor.finding_raised",
                   f"audit_finding:{f.id}", {"title": payload.title})
    await db.commit()
    return f.to_dict()

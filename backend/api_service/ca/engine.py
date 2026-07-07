# ca/engine.py
#
# Continuous compliance evaluation engine.
#
# Runs in Python (NOT Go workers) because evaluation is pure DB-query + rule
# logic over existing SQLAlchemy models. Two triggers funnel here:
#   1. event-driven: reporting ingest calls evaluate_org() after persisting
#      new ASM/VS results (real-time posture),
#   2. scheduled: utils/scheduler.py tick re-evaluates due orgs so evidence
#      freshness decays with time even when no scans run.
#
# Honesty invariants:
#   - a control with no evidence is "unknown" and scores 0 (never hidden),
#   - expired evidence contributes nothing,
#   - scores are floored, computed ONLY from ca_control_states,
#   - N/A survives re-evaluation but is never set automatically.

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from math import floor

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.ca_models import (
    CaCheck, CaControl, CaControlCheckMap, CaControlState, CaEvidence,
    CaEvidenceControlLink, CaFramework, CaGap, CaGapHistory, CaOrgFramework,
    CaPostureSnapshot, CaAuditTrail,
)
from ca.checks_registry import REGISTRY, CheckOutcome
from utils.constants import SLA_DAYS

logger = logging.getLogger("ca.engine")

# Gap SLA days by control criticality — shared with reporting/vs/ingest.py so
# remediation expectations are consistent platform-wide.
GAP_SLA_DAYS = SLA_DAYS

_ACTIVE_GAP_STATES = ("open", "in_progress")


def _canonical(data) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def _hash_evidence(content: dict, source_ref: dict) -> str:
    return hashlib.sha256((_canonical(content) + _canonical(source_ref)).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Immutable audit trail (hash-chained per org)
# ---------------------------------------------------------------------------
async def ca_trail(
    db: AsyncSession, org_id: str, actor: str | None, action: str,
    target: str | None = None, meta: dict | None = None,
) -> CaAuditTrail:
    prev = (
        await db.execute(
            select(CaAuditTrail.row_hash)
            .where(CaAuditTrail.org_id == org_id)
            .order_by(CaAuditTrail.seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    at = datetime.utcnow()
    row_hash = hashlib.sha256(
        f"{prev or ''}|{org_id}|{actor or ''}|{action}|{target or ''}|{_canonical(meta or {})}|{at.isoformat()}".encode()
    ).hexdigest()
    row = CaAuditTrail(
        org_id=org_id, actor_user_id=actor, action=action, target=target,
        meta=meta or {}, at=at, prev_hash=prev, row_hash=row_hash,
    )
    db.add(row)
    # The platform session runs autoflush=False (utils/database.py), so without
    # an explicit flush the next ca_trail() in this transaction would not see
    # this row and the hash chain would fork. Flush makes the chain linear.
    await db.flush()
    return row


# ---------------------------------------------------------------------------
# Posture math (§4 of docs/CA-MODULE-DESIGN.md) — the ONLY score formula
# ---------------------------------------------------------------------------
def compute_score(satisfied: int, partial: int, applicable: int) -> float | None:
    """floor((satisfied + 0.5*partial) / applicable * 100). None if nothing applicable."""
    if applicable <= 0:
        return None
    return float(floor((satisfied + 0.5 * partial) / applicable * 100))


async def posture_counts(db: AsyncSession, org_id: str, framework_id: str) -> dict:
    rows = (
        await db.execute(
            select(CaControlState.status, func.count(CaControlState.id))
            .join(CaControl, CaControl.id == CaControlState.control_id)
            .where(CaControlState.org_id == org_id, CaControl.framework_id == framework_id)
            .group_by(CaControlState.status)
        )
    ).all()
    counts = {"satisfied": 0, "partial": 0, "gap": 0, "not_applicable": 0, "unknown": 0}
    for status, n in rows:
        counts[status] = n
    total = sum(counts.values())
    applicable = total - counts["not_applicable"]
    score = compute_score(counts["satisfied"], counts["partial"], applicable)
    return {**counts, "total": total, "applicable": applicable, "score": score}


# ---------------------------------------------------------------------------
# Framework enablement — seed all control states as "unknown"
# ---------------------------------------------------------------------------
async def seed_control_states(db: AsyncSession, org_id: str, framework_id: str) -> int:
    control_ids = (
        await db.execute(select(CaControl.id).where(CaControl.framework_id == framework_id))
    ).scalars().all()
    existing = set(
        (
            await db.execute(
                select(CaControlState.control_id).where(
                    CaControlState.org_id == org_id, CaControlState.control_id.in_(control_ids)
                )
            )
        ).scalars().all()
    )
    n = 0
    for cid in control_ids:
        if cid not in existing:
            db.add(CaControlState(org_id=org_id, control_id=cid, status="unknown"))
            n += 1
    return n


# ---------------------------------------------------------------------------
# Evidence collection
# ---------------------------------------------------------------------------
async def _collect_check(db: AsyncSession, org_id: str, check: CaCheck) -> CaEvidence | None:
    """Run one automated check; insert fresh evidence when the outcome changed
    or the previous evidence expired. Returns the current-valid evidence row."""
    collector = REGISTRY.get(check.logic_key or "")
    if collector is None:  # loader validates this; belt-and-braces
        logger.error("CA check %s has unknown logic_key %s", check.key, check.logic_key)
        return None
    try:
        outcome: CheckOutcome = await collector(db, org_id, check.logic_params or {})
    except Exception:  # noqa: BLE001 — one broken collector must not sink the cycle
        logger.exception("CA collector %s failed for org %s", check.key, org_id)
        return None

    now = datetime.utcnow()
    content_hash = _hash_evidence(outcome.content, outcome.source_ref)

    prev = (
        await db.execute(
            select(CaEvidence)
            .where(
                CaEvidence.org_id == org_id,
                CaEvidence.check_id == check.id,
                CaEvidence.status == "valid",
                CaEvidence.collection == "automated",
            )
            .order_by(CaEvidence.captured_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if (
        prev is not None
        and prev.content_hash == content_hash
        and prev.result == outcome.result
        and prev.valid_until is not None
        and prev.valid_until > now
    ):
        return prev  # unchanged and fresh — no duplicate row

    if prev is not None:
        prev.status = "superseded"

    ev = CaEvidence(
        org_id=org_id,
        check_id=check.id,
        collection="automated",
        source_type=check.source_type or "vs",
        source_ref=outcome.source_ref,
        summary=outcome.summary,
        content=outcome.content,
        content_hash=content_hash,
        result=outcome.result,
        captured_at=now,
        valid_until=now + timedelta(days=check.freshness_days),
        status="valid",
        uploaded_by=None,
    )
    db.add(ev)
    await db.flush()
    return ev


async def _current_manual_evidence(db: AsyncSession, org_id: str, check: CaCheck) -> CaEvidence | None:
    """Manual checks pass only while a non-expired manual evidence row exists.
    Expired rows are flipped to stale here (freshness decay)."""
    now = datetime.utcnow()
    rows = (
        await db.execute(
            select(CaEvidence)
            .where(
                CaEvidence.org_id == org_id,
                CaEvidence.check_id == check.id,
                CaEvidence.collection == "manual",
                CaEvidence.status == "valid",
            )
            .order_by(CaEvidence.captured_at.desc())
        )
    ).scalars().all()
    current = None
    for ev in rows:
        if ev.valid_until is not None and ev.valid_until < now:
            ev.status = "stale"
            await _notify_evidence_expired(org_id, ev)
        elif current is None:
            current = ev
    return current


# ---------------------------------------------------------------------------
# Control status derivation (§4.1)
# ---------------------------------------------------------------------------
def _derive_status(check_results: list[dict]) -> str:
    """check_results: [{required, result}] where result is 'pass'|'fail'|None.
    None = no evidence, expired evidence, OR a 'no_data' outcome (a check that
    cannot honestly be asserted). Returns satisfied|partial|gap|unknown."""
    required = [c for c in check_results if c["required"]]
    supporting = [c for c in check_results if not c["required"]]
    if not required:
        required, supporting = supporting, []
    if not required:
        return "unknown"
    if all(c["result"] is None for c in required):
        return "unknown"
    req_pass = [c for c in required if c["result"] == "pass"]
    if len(req_pass) == len(required):
        if supporting and any(s["result"] == "fail" for s in supporting):
            return "partial"
        return "satisfied"
    if req_pass:
        return "partial"
    return "gap"


# ---------------------------------------------------------------------------
# Gap lifecycle (system-driven side)
# ---------------------------------------------------------------------------
async def _sync_gap(
    db: AsyncSession, org_id: str, control: CaControl, new_status: str, missing: list[dict],
) -> None:
    gap = (
        await db.execute(
            select(CaGap).where(
                CaGap.org_id == org_id,
                CaGap.control_id == control.id,
                CaGap.status.in_(_ACTIVE_GAP_STATES + ("resolved", "verified")),
            )
            .order_by(CaGap.first_detected_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    now = datetime.utcnow()

    if new_status in ("gap", "partial"):
        if gap is None or gap.status not in _ACTIVE_GAP_STATES:
            sla_days = GAP_SLA_DAYS.get(control.criticality, 30)
            gap = CaGap(
                org_id=org_id,
                control_id=control.id,
                dedup_key=control.id,
                title=f"Control {control.control_ref} not satisfied: {control.title}",
                description=f"Automated evaluation found this control in state '{new_status}'.",
                missing=missing,
                severity=control.criticality,
                status="open",
                sla_due_at=now + timedelta(days=sla_days),
                first_detected_at=now,
                last_detected_at=now,
            )
            db.add(gap)
            await db.flush()
            db.add(CaGapHistory(gap_id=gap.id, org_id=org_id, from_status=None,
                                to_status="open", actor_user_id=None,
                                justification="Detected by continuous evaluation."))
        else:
            gap.last_detected_at = now
            gap.missing = missing
    elif new_status == "satisfied" and gap is not None and gap.status in _ACTIVE_GAP_STATES:
        db.add(CaGapHistory(gap_id=gap.id, org_id=org_id, from_status=gap.status,
                            to_status="resolved", actor_user_id=None,
                            justification="Control returned to satisfied on re-evaluation."))
        gap.status = "resolved"
        gap.resolved_at = now


async def _notify_evidence_expired(org_id: str, ev: CaEvidence) -> None:
    try:
        from backend.notificationservice import dispatcher, events as evmod  # type: ignore
        await dispatcher.dispatch(
            None, org_id, evmod.EVIDENCE_EXPIRING,
            title="Compliance evidence expired",
            body=f"Manual evidence '{(ev.summary or '')[:80]}' passed its validity window and no longer counts.",
            severity="medium", link="/app/compliance",
            meta={"evidence_id": ev.id, "module": "ca"},
        )
    except Exception as e:  # noqa: BLE001
        logger.debug("CA evidence-expiry notify skipped: %s", e)


# ---------------------------------------------------------------------------
# Notifications (best-effort, never propagate)
# ---------------------------------------------------------------------------
async def _notify_control_change(org_id: str, control: CaControl, old: str, new: str) -> None:
    try:
        from backend.notificationservice import dispatcher, events as ev  # type: ignore
    except ImportError:
        try:
            import sys
            from pathlib import Path
            sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
            from backend.notificationservice import dispatcher, events as ev  # type: ignore
        except Exception:  # noqa: BLE001
            logger.warning("CA notify skipped: notificationservice unavailable")
            return
    try:
        if new in ("gap", "partial") and old in ("satisfied", "unknown"):
            await dispatcher.dispatch(
                None, org_id, ev.CONTROL_BROKE,
                title=f"Compliance control broke: {control.control_ref}",
                body=f"{control.title} moved from '{old}' to '{new}'.",
                severity="high" if control.criticality in ("critical", "high") else "medium",
                link="/app/compliance",
                meta={"control_id": control.id, "module": "ca"},
            )
        elif new == "satisfied" and old in ("gap", "partial"):
            await dispatcher.dispatch(
                None, org_id, ev.CONTROL_RESTORED,
                title=f"Compliance control restored: {control.control_ref}",
                body=f"{control.title} is satisfied again.",
                severity="info", link="/app/compliance",
                meta={"control_id": control.id, "module": "ca"},
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("CA notify failed: %s", e)


# ---------------------------------------------------------------------------
# Main evaluation cycle
# ---------------------------------------------------------------------------
async def evaluate_org(db: AsyncSession, org_id: str, reason: str = "manual") -> dict:
    """Evaluate all enabled frameworks for an org. Caller owns the transaction.
    Returns a summary diff. No-op if the org has no active frameworks."""
    enabled = (
        await db.execute(
            select(CaOrgFramework).where(
                CaOrgFramework.org_id == org_id, CaOrgFramework.status == "active"
            )
        )
    ).scalars().all()
    if not enabled:
        return {"evaluated": False, "reason": "no active frameworks"}

    framework_ids = [e.framework_id for e in enabled]

    controls = (
        await db.execute(select(CaControl).where(CaControl.framework_id.in_(framework_ids)))
    ).scalars().all()
    control_ids = [c.id for c in controls]

    maps = (
        await db.execute(
            select(CaControlCheckMap).where(CaControlCheckMap.control_id.in_(control_ids))
        )
    ).scalars().all()
    check_ids = {m.check_id for m in maps}
    checks = (
        await db.execute(select(CaCheck).where(CaCheck.id.in_(check_ids)))
    ).scalars().all() if check_ids else []
    checks_by_id = {c.id: c for c in checks}

    # 1. Collect each unique check ONCE across all enabled frameworks.
    evidence_by_check: dict[str, CaEvidence | None] = {}
    for check in checks:
        if check.collection == "automated":
            evidence_by_check[check.id] = await _collect_check(db, org_id, check)
        else:
            evidence_by_check[check.id] = await _current_manual_evidence(db, org_id, check)

    # 2. Materialize evidence→control links (transparency: which finding
    #    satisfies which control).
    maps_by_control: dict[str, list[CaControlCheckMap]] = {}
    for m in maps:
        maps_by_control.setdefault(m.control_id, []).append(m)

    ev_ids = [e.id for e in evidence_by_check.values() if e is not None]
    existing_links = set()
    if ev_ids:
        existing_links = {
            (r.evidence_id, r.control_id)
            for r in (
                await db.execute(
                    select(CaEvidenceControlLink.evidence_id, CaEvidenceControlLink.control_id)
                    .where(CaEvidenceControlLink.evidence_id.in_(ev_ids))
                )
            ).all()
        }
    for control_id, mlist in maps_by_control.items():
        for m in mlist:
            ev = evidence_by_check.get(m.check_id)
            if ev is not None and (ev.id, control_id) not in existing_links:
                db.add(CaEvidenceControlLink(org_id=org_id, evidence_id=ev.id, control_id=control_id))
                existing_links.add((ev.id, control_id))

    # 2b. Direct control-level manual evidence (check_id IS NULL). This is how
    #     controls WITHOUT any mapped check (the long tail of full framework
    #     catalogs) get satisfied: an uploaded, file-backed attestation linked
    #     straight to the control. For controls WITH checks it is shown as
    #     supporting material but never overrides check-derived status.
    now = datetime.utcnow()
    # Evidence/links added by the calling route (autoflush=False) must be
    # visible to the queries below.
    await db.flush()
    direct_by_control: dict[str, CaEvidence] = {}
    direct_rows = (
        await db.execute(
            select(CaEvidenceControlLink.control_id, CaEvidence)
            .join(CaEvidence, CaEvidence.id == CaEvidenceControlLink.evidence_id)
            .where(
                CaEvidenceControlLink.org_id == org_id,
                CaEvidenceControlLink.control_id.in_(control_ids),
                CaEvidence.check_id.is_(None),
                CaEvidence.status == "valid",
            )
        )
    ).all()
    for cid, dev in direct_rows:
        if dev.valid_until is not None and dev.valid_until < now:
            dev.status = "stale"
            await _notify_evidence_expired(org_id, dev)
        elif dev.result == "pass" and cid not in direct_by_control:
            direct_by_control[cid] = dev

    # 3. Recompute control states.
    states = (
        await db.execute(
            select(CaControlState).where(
                CaControlState.org_id == org_id, CaControlState.control_id.in_(control_ids)
            )
        )
    ).scalars().all()
    states_by_control = {s.control_id: s for s in states}
    changes: list[dict] = []

    for control in controls:
        state = states_by_control.get(control.id)
        if state is None:
            state = CaControlState(org_id=org_id, control_id=control.id, status="unknown")
            db.add(state)
            states_by_control[control.id] = state
        if state.status == "not_applicable":
            continue  # manual N/A survives re-evaluation; evidence keeps flowing

        check_results, missing = [], []
        for m in maps_by_control.get(control.id, []):
            check = checks_by_id.get(m.check_id)
            ev = evidence_by_check.get(m.check_id)
            effective = None
            if ev is not None and ev.status == "valid" and (ev.valid_until is None or ev.valid_until > now):
                # 'no_data' outcomes are recorded for transparency but never
                # count toward status — vacuous passes must not inflate.
                effective = ev.result if ev.result in ("pass", "fail") else None
            check_results.append({"required": m.required, "result": effective})
            if effective != "pass":
                missing.append({
                    "check_id": m.check_id,
                    "check_key": check.key if check else None,
                    "check_name": check.name if check else None,
                    "required": m.required,
                    "state": effective or "no_evidence",
                    "detail": (ev.summary if ev is not None else "No evidence collected yet."),
                })

        control_maps = maps_by_control.get(control.id, [])
        if control_maps:
            new_status = _derive_status(check_results)
        else:
            # No mapped checks: only a valid, passing, file-backed direct
            # attestation satisfies; otherwise honestly unknown.
            new_status = "satisfied" if control.id in direct_by_control else "unknown"
            if control.id in direct_by_control:
                missing = []
            else:
                missing = [{
                    "check_id": None, "check_key": None,
                    "check_name": "Direct attestation evidence",
                    "required": True, "state": "no_evidence",
                    "detail": "No automated check covers this control — upload manual evidence with a document.",
                }]
        old_status = state.status
        state.computed_at = now
        state.computed_from = [
            {
                "check_id": m.check_id,
                "evidence_id": (evidence_by_check.get(m.check_id).id
                                if evidence_by_check.get(m.check_id) else None),
                "required": m.required,
                "result": cr["result"],
            }
            for m, cr in zip(control_maps, check_results)
        ] or ([{"check_id": None,
                "evidence_id": direct_by_control[control.id].id,
                "required": True, "result": "pass"}]
              if control.id in direct_by_control else [])
        if new_status != old_status:
            state.status = new_status
            changes.append({"control_ref": control.control_ref, "from": old_status, "to": new_status})
            await ca_trail(
                db, org_id, None, "control.status_changed", f"control:{control.id}",
                {"from": old_status, "to": new_status, "reason": reason},
            )
            await _notify_control_change(org_id, control, old_status, new_status)
        await _sync_gap(db, org_id, control, new_status, missing)

    # 4. Daily posture snapshot per framework (real history only).
    today = now.strftime("%Y-%m-%d")
    for fw_id in framework_ids:
        counts = await posture_counts(db, org_id, fw_id)
        snap = (
            await db.execute(
                select(CaPostureSnapshot).where(
                    CaPostureSnapshot.org_id == org_id,
                    CaPostureSnapshot.framework_id == fw_id,
                    CaPostureSnapshot.snapshot_date == today,
                )
            )
        ).scalar_one_or_none()
        if snap is None:
            snap = CaPostureSnapshot(org_id=org_id, framework_id=fw_id, snapshot_date=today)
            db.add(snap)
        snap.satisfied = counts["satisfied"]
        snap.partial = counts["partial"]
        snap.gap = counts["gap"]
        snap.not_applicable = counts["not_applicable"]
        snap.unknown = counts["unknown"]
        snap.score = counts["score"]

    # 5. Advance the scheduler due-marker.
    for e in enabled:
        e.next_eval_at = now + timedelta(hours=6)

    return {"evaluated": True, "reason": reason, "checks_run": len(checks),
            "controls": len(controls), "changes": changes}


async def evaluate_org_isolated(org_id: str, reason: str) -> None:
    """Fire-and-forget wrapper with its own session — used by ingest hooks so a
    CA failure can never affect scan-result persistence."""
    try:
        from utils.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            result = await evaluate_org(db, org_id, reason)
            await db.commit()
            if result.get("changes"):
                logger.info("CA evaluation (%s) org=%s changes=%s", reason, org_id, result["changes"])
    except Exception:  # noqa: BLE001
        logger.exception("CA evaluation failed (org=%s, reason=%s)", org_id, reason)

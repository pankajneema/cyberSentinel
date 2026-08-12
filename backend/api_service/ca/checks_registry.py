# ca/checks_registry.py
#
# Automated evidence collectors. Each collector is an async function
#   fn(db, org_id, params) -> CheckOutcome
# that ONLY READS existing platform tables (vs_*, asm_*, assets, audit_logs,
# ca_policies) and returns a pass/fail outcome whose source_ref points at the
# REAL rows backing it. Collectors never invent data: a "pass" claim must be
# supported by resolvable rows, and failures carry the offending row ids so
# gap analysis can show exactly what's missing.

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

from sqlalchemy import func, select

from models.asm_models import AsmDiscovery
from models.asset_models import Asset
from models.tenancy_models import AuditLog, MemberProfile
from models.vs_models import VsFinding, VsScan, VsScanRun, VsScanTarget

# Mirrors routes/vs.py:_RESOLVED_STATES — findings in these states are not "open".
_VS_RESOLVED = ("remediated", "verified", "closed", "accepted_risk", "false_positive")


@dataclass
class CheckOutcome:
    # "pass" | "fail" | "no_data". no_data = the check cannot be honestly
    # asserted either way (e.g. "no open criticals" for an org that has never
    # scanned). It is recorded as evidence for transparency but contributes
    # NOTHING to control status — the control stays unknown, never satisfied.
    result: str
    summary: str
    source_ref: dict = field(default_factory=dict)
    content: dict = field(default_factory=dict)


def _window(days: int) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def _naive_utc(dt: datetime | None) -> datetime | None:
    """Timestamptz columns (e.g. assets.updated_at) come back tz-aware while
    our comparisons use naive UTC — normalize before any Python-side compare."""
    if dt is None or dt.tzinfo is None:
        return dt
    from datetime import timezone
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


async def _has_completed_scan(db, org_id: str, window_days: int = 92) -> bool:
    row = (
        await db.execute(
            select(VsScanRun.id)
            .where(
                VsScanRun.org_id == org_id,
                VsScanRun.status == "COMPLETED",
                VsScanRun.completed_at >= _window(window_days),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return row is not None


async def vs_scan_recency(db, org_id: str, params: dict) -> CheckOutcome:
    max_age = int(params.get("max_age_days", 92))
    rows = (
        await db.execute(
            select(VsScanRun.id, VsScanRun.completed_at)
            .where(
                VsScanRun.org_id == org_id,
                VsScanRun.status == "COMPLETED",
                VsScanRun.completed_at >= _window(max_age),
            )
            .order_by(VsScanRun.completed_at.desc())
            .limit(10)
        )
    ).all()
    ids = [r.id for r in rows]
    if ids:
        latest = rows[0].completed_at
        return CheckOutcome(
            "pass",
            f"{len(ids)} completed vulnerability scan(s) in the last {max_age} days "
            f"(latest {latest:%Y-%m-%d}).",
            {"table": "vs_scan_runs", "ids": ids, "query_window_days": max_age},
            {"completed_runs": len(ids), "latest_completed_at": latest.isoformat() + "Z"},
        )
    return CheckOutcome(
        "fail",
        f"No completed vulnerability scan in the last {max_age} days.",
        {"table": "vs_scan_runs", "ids": [], "query_window_days": max_age},
        {"completed_runs": 0},
    )


async def vs_no_open_findings(db, org_id: str, params: dict) -> CheckOutcome:
    severity = params.get("severity", "critical")
    max_open = int(params.get("max_open", 0))
    # Anti-inflation gate: "zero open criticals" is only meaningful if the org
    # actually scans. A never-scanned org must NOT pass this check vacuously.
    if not await _has_completed_scan(db, org_id):
        return CheckOutcome(
            "no_data",
            "No completed vulnerability scan in the last 92 days — absence of "
            f"open {severity} findings cannot be asserted.",
            {"table": "vs_scan_runs", "ids": []},
            {"gated": "no_completed_scan"},
        )
    rows = (
        await db.execute(
            select(VsFinding.id)
            .where(
                VsFinding.org_id == org_id,
                VsFinding.severity == severity,
                VsFinding.status.notin_(_VS_RESOLVED),
            )
            .limit(200)
        )
    ).scalars().all()
    if len(rows) <= max_open:
        return CheckOutcome(
            "pass",
            f"{len(rows)} open {severity} finding(s) (threshold {max_open}).",
            {"table": "vs_findings", "ids": rows, "severity": severity},
            {"open_count": len(rows), "max_open": max_open},
        )
    return CheckOutcome(
        "fail",
        f"{len(rows)} open {severity} finding(s) exceed the threshold of {max_open}.",
        {"table": "vs_findings", "ids": rows[:50], "severity": severity},
        {"open_count": len(rows), "max_open": max_open},
    )


async def vs_remediation_sla(db, org_id: str, params: dict) -> CheckOutcome:
    severities = params.get("severities", ["critical", "high"])
    if not await _has_completed_scan(db, org_id):
        return CheckOutcome(
            "no_data",
            "No completed vulnerability scan in the last 92 days — SLA compliance "
            "cannot be asserted without scan data.",
            {"table": "vs_scan_runs", "ids": []},
            {"gated": "no_completed_scan"},
        )
    now = datetime.utcnow()
    overdue = (
        await db.execute(
            select(VsFinding.id)
            .where(
                VsFinding.org_id == org_id,
                VsFinding.severity.in_(severities),
                VsFinding.status.notin_(_VS_RESOLVED),
                VsFinding.sla_due_at.isnot(None),
                VsFinding.sla_due_at < now,
            )
            .limit(200)
        )
    ).scalars().all()
    if not overdue:
        return CheckOutcome(
            "pass",
            f"No active {'/'.join(severities)} findings past their remediation SLA.",
            {"table": "vs_findings", "ids": [], "severities": severities},
            {"overdue_count": 0},
        )
    return CheckOutcome(
        "fail",
        f"{len(overdue)} active {'/'.join(severities)} finding(s) are past their remediation SLA.",
        {"table": "vs_findings", "ids": overdue[:50], "severities": severities},
        {"overdue_count": len(overdue)},
    )


async def vs_scan_coverage(db, org_id: str, params: dict) -> CheckOutcome:
    window_days = int(params.get("window_days", 90))
    min_pct = float(params.get("min_pct", 80))
    active_assets = (
        await db.execute(
            select(Asset.id).where(Asset.org_id == org_id, Asset.status == "active")
        )
    ).scalars().all()
    if not active_assets:
        return CheckOutcome(
            "fail",
            "No active assets in the inventory — coverage cannot be demonstrated.",
            {"table": "assets", "ids": []},
            {"active_assets": 0, "covered": 0, "pct": 0, "min_pct": min_pct},
        )
    covered = (
        await db.execute(
            select(func.count(func.distinct(VsScanTarget.asset_id)))
            .select_from(VsScanTarget)
            .join(VsScanRun, VsScanRun.id == VsScanTarget.scan_run_id)
            .where(
                VsScanRun.org_id == org_id,
                VsScanRun.status == "COMPLETED",
                VsScanRun.completed_at >= _window(window_days),
                VsScanTarget.asset_id.in_(active_assets),
            )
        )
    ).scalar() or 0
    pct = round(covered / len(active_assets) * 100, 1)
    outcome = "pass" if pct >= min_pct else "fail"
    return CheckOutcome(
        outcome,
        f"{covered}/{len(active_assets)} active assets ({pct}%) scanned in the last "
        f"{window_days} days (required ≥{min_pct}%).",
        {"table": "vs_scan_targets", "join": "vs_scan_runs", "window_days": window_days},
        {"active_assets": len(active_assets), "covered": covered, "pct": pct, "min_pct": min_pct},
    )


async def vs_rescan_after_remediation(db, org_id: str, params: dict) -> CheckOutcome:
    window_days = int(params.get("window_days", 92))
    resolved = (
        await db.execute(
            select(VsFinding.id, VsFinding.resolved_at)
            .where(
                VsFinding.org_id == org_id,
                VsFinding.status.in_(("verified", "closed")),
                VsFinding.resolved_at >= _window(window_days),
            )
            .limit(200)
        )
    ).all()
    if not resolved:
        # Nothing was remediated, so "rescans confirm resolution" cannot be
        # demonstrated — no_data, NOT a vacuous pass (SOC2 CC7.5 inflation fix).
        return CheckOutcome(
            "no_data",
            f"No findings verified/closed in the last {window_days} days — "
            "rescan verification has nothing to attest.",
            {"table": "vs_findings", "ids": []},
            {"resolved_count": 0},
        )
    unverified = []
    for row in resolved:
        rescanned = (
            await db.execute(
                select(VsScanRun.id)
                .where(
                    VsScanRun.org_id == org_id,
                    VsScanRun.status == "COMPLETED",
                    VsScanRun.completed_at >= row.resolved_at,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if rescanned is None:
            unverified.append(row.id)
    if not unverified:
        return CheckOutcome(
            "pass",
            f"All {len(resolved)} recently resolved finding(s) are backed by a completed rescan.",
            {"table": "vs_findings", "ids": [r.id for r in resolved][:50]},
            {"resolved_count": len(resolved), "unverified_by_rescan": 0},
        )
    return CheckOutcome(
        "fail",
        f"{len(unverified)} resolved finding(s) lack a completed rescan after remediation.",
        {"table": "vs_findings", "ids": unverified[:50]},
        {"resolved_count": len(resolved), "unverified_by_rescan": len(unverified)},
    )


async def scan_config_continuous_schedule(db, org_id: str, params: dict) -> CheckOutcome:
    vs_scheduled = (
        await db.execute(
            select(VsScan.id)
            .where(
                VsScan.org_id == org_id,
                VsScan.schedule_type.in_(("INTERVAL", "CRON")),
                VsScan.status.notin_(("PAUSED", "DELETED")),
                VsScan.next_run_at.isnot(None),
            )
            .limit(20)
        )
    ).scalars().all()
    asm_scheduled = (
        await db.execute(
            select(AsmDiscovery.id)
            .where(
                AsmDiscovery.org_id == org_id,
                AsmDiscovery.schedule_type.in_(("INTERVAL", "CRON")),
                AsmDiscovery.status.notin_(("PAUSED", "DELETED")),
                AsmDiscovery.next_run_at.isnot(None),
            )
            .limit(20)
        )
    ).scalars().all()
    total = len(vs_scheduled) + len(asm_scheduled)
    if total:
        return CheckOutcome(
            "pass",
            f"{len(vs_scheduled)} recurring scan schedule(s) and {len(asm_scheduled)} recurring "
            "discovery schedule(s) are active.",
            {"tables": {"vs_scans": vs_scheduled, "asm_discoveries": asm_scheduled}},
            {"vs_schedules": len(vs_scheduled), "asm_schedules": len(asm_scheduled)},
        )
    return CheckOutcome(
        "fail",
        "No active recurring (INTERVAL/CRON) scan or discovery schedule exists.",
        {"tables": {"vs_scans": [], "asm_discoveries": []}},
        {"vs_schedules": 0, "asm_schedules": 0},
    )


async def asm_inventory_maintained(db, org_id: str, params: dict) -> CheckOutcome:
    max_age = int(params.get("max_age_days", 90))
    count = (
        await db.execute(
            select(func.count(Asset.id)).where(Asset.org_id == org_id, Asset.status == "active")
        )
    ).scalar() or 0
    if count == 0:
        return CheckOutcome(
            "fail",
            "Asset inventory is empty — no active assets registered.",
            {"table": "assets", "ids": []},
            {"active_assets": 0},
        )
    latest = _naive_utc(
        (
            await db.execute(
                select(func.max(Asset.updated_at)).where(Asset.org_id == org_id)
            )
        ).scalar()
    )
    fresh = latest is not None and latest >= _window(max_age)
    if fresh:
        return CheckOutcome(
            "pass",
            f"{count} active asset(s); inventory last updated {latest:%Y-%m-%d}.",
            {"table": "assets", "count": count},
            {"active_assets": count, "last_updated": latest.isoformat() + "Z"},
        )
    return CheckOutcome(
        "fail",
        f"Inventory has {count} asset(s) but none updated in the last {max_age} days.",
        {"table": "assets", "count": count},
        {"active_assets": count, "last_updated": (latest.isoformat() + "Z") if latest else None},
    )


async def asm_ownership_verified(db, org_id: str, params: dict) -> CheckOutcome:
    min_pct = float(params.get("min_pct", 80))
    total = (
        await db.execute(
            select(func.count(Asset.id)).where(Asset.org_id == org_id, Asset.status == "active")
        )
    ).scalar() or 0
    if total == 0:
        return CheckOutcome(
            "fail",
            "No active assets — ownership verification cannot be demonstrated.",
            {"table": "assets"},
            {"active_assets": 0, "verified": 0, "pct": 0, "min_pct": min_pct},
        )
    verified = (
        await db.execute(
            select(func.count(Asset.id)).where(
                Asset.org_id == org_id, Asset.status == "active", Asset.ownership_verified.is_(True)
            )
        )
    ).scalar() or 0
    pct = round(verified / total * 100, 1)
    outcome = "pass" if pct >= min_pct else "fail"
    return CheckOutcome(
        outcome,
        f"{verified}/{total} active assets ({pct}%) ownership-verified (required ≥{min_pct}%).",
        {"table": "assets", "count": total},
        {"active_assets": total, "verified": verified, "pct": pct, "min_pct": min_pct},
    )


async def asm_discovery_recency(db, org_id: str, params: dict) -> CheckOutcome:
    max_age = int(params.get("max_age_days", 30))
    rows = (
        await db.execute(
            select(AsmDiscovery.id, AsmDiscovery.last_run_at)
            .where(
                AsmDiscovery.org_id == org_id,
                AsmDiscovery.last_run_at >= _window(max_age),
            )
            .order_by(AsmDiscovery.last_run_at.desc())
            .limit(10)
        )
    ).all()
    if rows:
        return CheckOutcome(
            "pass",
            f"{len(rows)} ASM discovery run(s) in the last {max_age} days "
            f"(latest {rows[0].last_run_at:%Y-%m-%d}).",
            {"table": "asm_discoveries", "ids": [r.id for r in rows]},
            {"recent_discoveries": len(rows), "latest_run_at": rows[0].last_run_at.isoformat() + "Z"},
        )
    return CheckOutcome(
        "fail",
        f"No ASM discovery has run in the last {max_age} days.",
        {"table": "asm_discoveries", "ids": []},
        {"recent_discoveries": 0},
    )


async def audit_trail_active(db, org_id: str, params: dict) -> CheckOutcome:
    max_age = int(params.get("max_age_days", 30))
    count = (
        await db.execute(
            select(func.count(AuditLog.id)).where(
                AuditLog.org_id == org_id, AuditLog.created_at >= _window(max_age)
            )
        )
    ).scalar() or 0
    if count:
        return CheckOutcome(
            "pass",
            f"{count} audit-log event(s) recorded in the last {max_age} days.",
            {"table": "audit_logs", "count": count, "window_days": max_age},
            {"events": count},
        )
    return CheckOutcome(
        "fail",
        f"No audit-log activity recorded in the last {max_age} days.",
        {"table": "audit_logs", "count": 0, "window_days": max_age},
        {"events": 0},
    )


async def audit_access_managed(db, org_id: str, params: dict) -> CheckOutcome:
    review_days = int(params.get("review_days", 365))
    members = (
        await db.execute(
            select(func.count(MemberProfile.id)).where(
                MemberProfile.org_id == org_id, MemberProfile.is_active.is_(True)
            )
        )
    ).scalar() or 0
    if members == 0:
        return CheckOutcome(
            "fail",
            "No active members found for the organization.",
            {"table": "member_profiles"},
            {"active_members": 0, "member_events": 0},
        )
    member_events = (
        await db.execute(
            select(func.count(AuditLog.id)).where(
                AuditLog.org_id == org_id,
                AuditLog.action.like("member.%"),
                AuditLog.created_at >= _window(review_days),
            )
        )
    ).scalar() or 0
    if member_events:
        return CheckOutcome(
            "pass",
            f"{members} active member(s) under role-based access; {member_events} membership/role "
            f"event(s) recorded in the last {review_days} days.",
            {"table": "audit_logs", "action_prefix": "member.", "window_days": review_days},
            {"active_members": members, "member_events": member_events},
        )
    return CheckOutcome(
        "fail",
        f"No membership/role change events recorded in the last {review_days} days — "
        "access review activity cannot be demonstrated.",
        {"table": "audit_logs", "action_prefix": "member.", "window_days": review_days},
        {"active_members": members, "member_events": 0},
    )


async def policy_active_and_acked(db, org_id: str, params: dict) -> CheckOutcome:
    # Imported here to avoid a models import cycle at module load.
    from models.ca_models import CaPolicy, CaPolicyAck

    policy_key = params.get("policy_key")
    min_ack_pct = float(params.get("min_ack_pct", 80))
    now = datetime.utcnow()

    policy = (
        await db.execute(
            select(CaPolicy).where(
                CaPolicy.org_id == org_id, CaPolicy.key == policy_key, CaPolicy.status == "active"
            )
        )
    ).scalar_one_or_none()
    if policy is None or not policy.current_version_id:
        return CheckOutcome(
            "fail",
            f"No active policy '{policy_key}' with a published version exists.",
            {"table": "ca_policies", "policy_key": policy_key},
            {"policy_exists": False},
        )
    if policy.next_review_at is not None and policy.next_review_at < now:
        return CheckOutcome(
            "fail",
            f"Policy '{policy_key}' is past its review date ({policy.next_review_at:%Y-%m-%d}).",
            {"table": "ca_policies", "ids": [policy.id]},
            {"policy_exists": True, "review_overdue": True},
        )
    members = (
        await db.execute(
            select(func.count(MemberProfile.id)).where(
                MemberProfile.org_id == org_id, MemberProfile.is_active.is_(True)
            )
        )
    ).scalar() or 0
    acks = (
        await db.execute(
            select(func.count(CaPolicyAck.id)).where(
                CaPolicyAck.org_id == org_id,
                CaPolicyAck.policy_version_id == policy.current_version_id,
            )
        )
    ).scalar() or 0
    pct = round(acks / members * 100, 1) if members else 0.0
    outcome = "pass" if pct >= min_ack_pct else "fail"
    return CheckOutcome(
        outcome,
        f"Policy '{policy_key}' active; {acks}/{members} member(s) ({pct}%) acknowledged the "
        f"current version (required ≥{min_ack_pct}%).",
        {"table": "ca_policies", "ids": [policy.id], "version_id": policy.current_version_id},
        {"policy_exists": True, "members": members, "acks": acks, "pct": pct, "min_ack_pct": min_ack_pct},
    )


Collector = Callable[[Any, str, dict], Awaitable[CheckOutcome]]

REGISTRY: dict[str, Collector] = {
    "vs.scan_recency": vs_scan_recency,
    "vs.no_open_findings": vs_no_open_findings,
    "vs.remediation_sla": vs_remediation_sla,
    "vs.scan_coverage": vs_scan_coverage,
    "vs.rescan_after_remediation": vs_rescan_after_remediation,
    "scan_config.continuous_schedule": scan_config_continuous_schedule,
    "asm.inventory_maintained": asm_inventory_maintained,
    "asm.ownership_verified": asm_ownership_verified,
    "asm.discovery_recency": asm_discovery_recency,
    "audit.trail_active": audit_trail_active,
    "audit.access_managed": audit_access_managed,
    "policy.active_and_acked": policy_active_and_acked,
}

"""VS domain service.

Business logic for the VS module: the single place the `jobs.vs` queue
envelope is built, plus the scheduler ticks (due recurring scans, daily trend
snapshots).

NOTE: the manual-run route (routes/vs.py) and the scheduler tick deliberately
differ — the route hard-fails on unverified assets and ignores the profile's
scan window, while the scheduler silently filters unsafe targets and enforces
the window. Both call build_job_message so the envelope stays identical.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update

from utils.queue import publish_message
from utils.schedule_math import compute_next_run

logger = logging.getLogger("cybersentinel.vs")

QUEUE = "jobs.vs"


# ---------------------------------------------------------------------------
# Queue envelope — cross-language contract with the Go worker
# (consumer/vs/job.go); the field set must not change.
# ---------------------------------------------------------------------------
def build_job_message(run_id: str, scan_id: str, org_id: str, profile: dict, targets: list[dict]) -> dict:
    return {
        "type": "vs", "id": run_id, "scan_id": scan_id, "org_id": org_id,
        "profile": profile,
        "targets": targets,
    }


async def enqueue_run(message: dict) -> bool:
    return await publish_message(QUEUE, message)


# ---------------------------------------------------------------------------
# Scheduler tick — due recurring scans
# ---------------------------------------------------------------------------
def _in_scan_window(window: dict, now_utc: datetime) -> bool:
    """True if `now_utc` falls inside the profile's scan window
    {start:"HH:MM", end:"HH:MM", tz:"Area/City"}. Handles windows that cross
    midnight (start > end). Missing/invalid window => always allowed."""
    if not isinstance(window, dict):
        return True
    start, end = window.get("start"), window.get("end")
    if not start or not end:
        return True
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(window.get("tz") or "UTC")
        local = now_utc.replace(tzinfo=timezone.utc).astimezone(tz)
        cur = local.strftime("%H:%M")
    except Exception:  # noqa: BLE001 - bad tz => don't block scanning
        return True
    if start <= end:
        return start <= cur <= end
    return cur >= start or cur <= end   # crosses midnight


async def tick_due_scans(db, now: datetime, stale_minutes: int) -> int:
    """Enqueue due recurring VS scans (INTERVAL/CRON). Mirrors the ASM due-scan
    discipline: FOR UPDATE SKIP LOCKED, overlap prevention (skip RUNNING/PAUSED/
    DELETED), and only ownership-verified + SSRF-safe targets are scanned."""
    from models.vs_models import VsScan, VsScanRun, VsScanTarget, VsScanProfile
    from models.asset_models import Asset as AssetModel
    from utils.target_guard import validate_scan_target

    # Reap crashed VS scans (stuck RUNNING past the stale window) so they can re-run.
    cutoff = now - timedelta(minutes=stale_minutes)
    await db.execute(
        update(VsScan).where(VsScan.status == "RUNNING", VsScan.updated_at < cutoff)
        .values(status="FAILED", updated_at=now)
    )

    due = (await db.execute(
        select(VsScan).where(
            VsScan.schedule_type.in_(("INTERVAL", "CRON")),
            VsScan.next_run_at.isnot(None),
            VsScan.next_run_at <= now,
            VsScan.status.notin_(("RUNNING", "PAUSED", "DELETED")),
        ).with_for_update(skip_locked=True)
    )).scalars().all()

    scheduled = 0
    for scan in due:
        nxt = compute_next_run(scan.schedule_type, scan.schedule_value, scan.next_run_at)
        if nxt is not None and nxt <= now:
            nxt = compute_next_run(scan.schedule_type, scan.schedule_value, now)
        if nxt is None:
            logger.warning("VS scan %s has invalid schedule_value=%r", scan.id, scan.schedule_value)
            continue

        prof = (await db.execute(select(VsScanProfile).where(
            VsScanProfile.id == scan.profile_id))).scalar_one_or_none()
        # Scan-window enforcement: outside the profile's window, defer WITHOUT
        # advancing next_run_at so the scan fires as soon as the window opens.
        if prof and prof.scan_window and not _in_scan_window(prof.scan_window, now):
            logger.info("VS scan %s deferred: outside scan window", scan.id)
            continue

        assets = (await db.execute(select(AssetModel).where(
            AssetModel.id.in_(scan.asset_ids or []),
            AssetModel.org_id == scan.org_id))).scalars().all()
        safe = []
        for a in assets:
            if not a.ownership_verified:
                continue
            try:
                validate_scan_target(a.name)
                safe.append(a)
            except ValueError:
                continue

        # Always advance next_run_at so an all-unverified scan doesn't hot-loop.
        scan.next_run_at = nxt
        scan.updated_at = now
        if not safe:
            logger.info("VS scan %s skipped: no verified/safe targets", scan.id)
            continue

        run = VsScanRun(scan_id=scan.id, org_id=scan.org_id, status="PENDING",
                        triggered_by="schedule", started_at=now)
        db.add(run)
        await db.flush()
        for a in safe:
            db.add(VsScanTarget(scan_run_id=run.id, org_id=scan.org_id, asset_id=a.id,
                                host=a.name, authorized=True, status="pending"))
        message = build_job_message(
            run.id, scan.id, scan.org_id,
            prof.to_dict() if prof else {},
            [{"asset_id": a.id, "host": a.name} for a in safe],
        )
        if await enqueue_run(message):
            scan.status = "RUNNING"
            scan.last_run_at = now
            scan.last_run_id = run.id
            scheduled += 1
        else:
            run.status = "FAILED"
            run.error_message = "failed to enqueue scan job"
            logger.error("failed to enqueue scheduled VS scan %s", scan.id)

    await db.commit()
    if scheduled:
        logger.info("enqueued %d due VS scan(s)", scheduled)
    return scheduled


# ---------------------------------------------------------------------------
# Daily trend snapshots
# ---------------------------------------------------------------------------
async def snapshot_trends(db, now: datetime) -> int:
    """Write one VS severity snapshot per org per day (real finding counts).
    Idempotent via ON CONFLICT (org_id, snapshot_date)."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from models.vs_models import VsFinding, VsTrendSnapshot

    day = now.strftime("%Y-%m-%d")
    active = ("open", "confirmed", "in_progress")
    org_ids = (await db.execute(
        select(VsFinding.org_id).distinct())).scalars().all()
    written = 0
    for org_id in org_ids:
        if not org_id:
            continue

        async def _c(*conds) -> int:
            return (await db.execute(select(func.count()).select_from(VsFinding)
                    .where(VsFinding.org_id == org_id, *conds))).scalar() or 0

        row = {
            "id": f"{org_id}:{day}",
            "org_id": org_id, "snapshot_date": day,
            "total": await _c(VsFinding.status.in_(active)),
            "critical": await _c(VsFinding.status.in_(active), VsFinding.severity == "critical"),
            "high": await _c(VsFinding.status.in_(active), VsFinding.severity == "high"),
            "medium": await _c(VsFinding.status.in_(active), VsFinding.severity == "medium"),
            "low": await _c(VsFinding.status.in_(active), VsFinding.severity == "low"),
            "kev": await _c(VsFinding.status.in_(active), VsFinding.kev.is_(True)),
            "open_count": await _c(VsFinding.status == "open"),
            "remediated_count": await _c(VsFinding.status.in_(("remediated", "verified", "closed"))),
        }
        stmt = pg_insert(VsTrendSnapshot).values(row)
        stmt = stmt.on_conflict_do_update(
            index_elements=["org_id", "snapshot_date"],
            set_={k: row[k] for k in ("total", "critical", "high", "medium", "low",
                                      "kev", "open_count", "remediated_count")},
        )
        await db.execute(stmt)
        written += 1
    await db.commit()
    if written:
        logger.info("wrote VS trend snapshot for %d org(s) on %s", written, day)
    return written

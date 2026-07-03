"""
Recurring discovery scheduler + stale-job reaper.

A lightweight async background loop (started in `main.py`) that keeps ASM
discoveries running on schedule and prevents crashed scans from being stranded.

Each tick does three things:
  1. **Reap stale RUNNING jobs** — a discovery stuck in RUNNING with no update for
     longer than STALE_RUNNING_MINUTES (worker crashed mid-scan) is marked FAILED so
     it can be re-scheduled instead of blocking forever. (Phase A: stale-RUNNING reaper.)
  2. **Re-enqueue due recurring discoveries** — INTERVAL (`5h`, `24h`, `168h`, …) and
     CRON (`*/10 * * * *`) schedules whose `next_run_at` is due are re-published to
     `jobs.asm`, then `next_run_at` is recomputed.
  3. PAUSED / DELETED discoveries are skipped; QUICK discoveries run once and are
     never rescheduled.

The loop is crash-tolerant (a failing tick logs and retries) and idempotent (a job
already RUNNING is skipped, so two API replicas can't double-enqueue).
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import select, update, func

from utils.database import AsyncSessionLocal
from utils.queue import publish_message
from utils.schedule_math import (  # pure math, dependency-free + unit-tested
    parse_interval,
    next_cron,
    compute_next_run,
    _HAS_CRONITER,
)
from models.asm_models import AsmDiscovery

logger = logging.getLogger("cybersentinel.scheduler")

POLL_SECONDS = int(os.getenv("ASM_SCHEDULER_POLL_SECONDS", "60"))
QUEUE = "jobs.asm"

# A RUNNING discovery that hasn't been touched for this long is assumed crashed.
# The DB `updated_at` only advances at RUNNING-start and terminal states (per-stage
# progress is kept in Redis), so the cutoff MUST exceed the worker's worst-case
# single-scan time or the reaper will kill a legitimately long scan and re-enqueue
# a duplicate. We therefore floor the cutoff at 2x the worker task timeout,
# regardless of what ASM_STALE_RUNNING_MINUTES is set to.
_TASK_TIMEOUT_SECONDS = int(os.getenv("TASK_TIMEOUT_SECONDS", "900"))
_MIN_STALE_MINUTES = max(1, (_TASK_TIMEOUT_SECONDS * 2 + 59) // 60)  # ceil(2x timeout) in minutes
STALE_RUNNING_MINUTES = max(
    int(os.getenv("ASM_STALE_RUNNING_MINUTES", "30")),
    _MIN_STALE_MINUTES,
)

__all__ = ["parse_interval", "next_cron", "compute_next_run", "scheduler_loop"]


async def _emit_schedule_events(db, started: list[dict], reaped: list[dict]) -> None:
    """Best-effort notifications for scheduler-driven start/reap. Never raises."""
    try:
        from notificationservice import dispatcher
        from notificationservice import events as _ev
    except Exception:  # noqa: BLE001
        return
    for d in started:
        if not d.get("org_id"):
            continue
        try:
            await dispatcher.dispatch(
                db, d["org_id"], _ev.SCAN_STARTED,
                title=f"Scheduled discovery started: {d.get('name') or d['id']}",
                link=f"/app/asm?discovery={d['id']}",
                meta={"discovery_id": d["id"], "scheduled": True},
                owner_user_id=d.get("user_id"),
            )
        except Exception:  # noqa: BLE001
            pass
    for d in reaped:
        if not d.get("org_id"):
            continue
        try:
            await dispatcher.dispatch(
                db, d["org_id"], _ev.SCAN_FAILED,
                title=f"Discovery reaped (stalled): {d.get('name') or d['id']}",
                body="The run exceeded the stale-timeout and was marked failed so it can re-run.",
                severity="high",
                link=f"/app/asm?discovery={d['id']}",
                meta={"discovery_id": d["id"], "reaped": True},
                owner_user_id=d.get("user_id"),
            )
        except Exception:  # noqa: BLE001
            pass


async def _reap_stale(db, now: datetime) -> list[dict]:
    """Mark crashed (stale-RUNNING) discoveries FAILED so they aren't stranded.

    Returns lightweight descriptors of the reaped discoveries so the caller can
    emit a 'scan failed' notification for each (after the tick commits)."""
    cutoff = now - timedelta(minutes=STALE_RUNNING_MINUTES)
    stale = (
        await db.execute(
            select(AsmDiscovery.id, AsmDiscovery.org_id, AsmDiscovery.user_id, AsmDiscovery.name)
            .where(AsmDiscovery.status == "RUNNING", AsmDiscovery.updated_at < cutoff)
        )
    ).all()
    if not stale:
        return []
    await db.execute(
        update(AsmDiscovery)
        .where(AsmDiscovery.status == "RUNNING", AsmDiscovery.updated_at < cutoff)
        .values(status="FAILED", updated_at=now)
    )
    logger.warning("reaped %d stale RUNNING discovery(ies) older than %dm", len(stale), STALE_RUNNING_MINUTES)
    return [
        {"id": r[0], "org_id": r[1], "user_id": r[2], "name": r[3]}
        for r in stale
    ]


async def _auto_score_assets(db, limit: int = 200) -> int:
    """Automatically score assets that have ASM scan data but no (or stale) score.

    This is what makes the dashboard's risk numbers populate on their own after an
    auto-scheduled scan: the pipeline discovers/persists IPs+ports+certs, and this
    pass runs the defensible model (scoring/exposure.py) to set AssetModel.risk_score.
    No fake numbers — an asset with no matching scan data stays Unscanned.

    Selection (bounded per tick):
      - risk_score IS NULL  (never scored), OR
      - last_scored_at is older than the org's most recent COMPLETED discovery
        (new scan data arrived since we last scored).
    """
    # Local imports keep this dependency-light and avoid an import cycle at startup.
    from sqlalchemy import or_
    from models.asset_models import Asset as AssetModel
    from routes.assets import _gather_asset_signals
    from scoring import score_exposure

    # Most-recent COMPLETED discovery per org (new data => rescore).
    latest_rows = (
        await db.execute(
            select(AsmDiscovery.org_id, func.max(AsmDiscovery.updated_at))
            .where(AsmDiscovery.status == "COMPLETED", AsmDiscovery.org_id.isnot(None))
            .group_by(AsmDiscovery.org_id)
        )
    ).all()
    latest_by_org = {org_id: ts for org_id, ts in latest_rows if org_id}

    candidates = (
        await db.execute(
            select(AssetModel)
            .where(AssetModel.org_id.isnot(None))
            .where(or_(AssetModel.risk_score.is_(None), AssetModel.last_scored_at.is_(None)))
            .limit(limit)
        )
    ).scalars().all()

    # Add stale (already-scored but org has newer scan data) assets, bounded.
    if len(candidates) < limit:
        already = {a.id for a in candidates}
        scored_assets = (
            await db.execute(
                select(AssetModel)
                .where(AssetModel.org_id.isnot(None))
                .where(AssetModel.last_scored_at.isnot(None))
                .limit(limit)
            )
        ).scalars().all()
        for a in scored_assets:
            newest = latest_by_org.get(a.org_id)
            if newest and a.last_scored_at and a.last_scored_at < newest and a.id not in already:
                candidates.append(a)
                if len(candidates) >= limit:
                    break

    scored = 0
    # Shared per-tick cache: each org's IPs/certs/ports are loaded once, not
    # re-fetched per asset (collapses ~O(assets*4) queries to ~O(orgs*4)).
    signal_cache: dict = {}
    for asset in candidates:
        try:
            signals, _ = await _gather_asset_signals(db, asset.org_id, asset, cache=signal_cache)
        except Exception as exc:  # noqa: BLE001
            logger.warning("auto-score signal gather failed for asset %s: %s", asset.id, exc)
            continue
        if signals is None:
            continue  # no scan data yet -> stays Unscanned (no fake number)
        result = score_exposure(signals)
        asset.risk_score = result.score
        asset.last_scored_at = datetime.utcnow()
        scored += 1

    if scored:
        await db.commit()
        logger.info("auto-scored %d asset(s) from real ASM scan data", scored)
    return scored


async def _tick() -> int:
    """Reap stale jobs, re-enqueue due recurring discoveries, auto-score assets."""
    scheduled = 0
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()

        # 1) Reaper (Phase A) — do this first so a crashed recurring job becomes
        #    eligible to run again on its next tick.
        reaped = await _reap_stale(db, now)
        started: list[dict] = []

        # 2) Due recurring discoveries: INTERVAL or CRON, due, not currently running,
        #    not paused/deleted.
        # FOR UPDATE SKIP LOCKED so that with multiple API replicas running this
        # loop, each due row is claimed by exactly one replica for this tick —
        # otherwise two replicas SELECT the same COMPLETED row and double-enqueue.
        due = (
            await db.execute(
                select(AsmDiscovery).where(
                    AsmDiscovery.schedule_type.in_(("INTERVAL", "CRON")),
                    AsmDiscovery.next_run_at.isnot(None),
                    AsmDiscovery.next_run_at <= now,
                    AsmDiscovery.status.notin_(("RUNNING", "PAUSED", "DELETED")),
                ).with_for_update(skip_locked=True)
            )
        ).scalars().all()

        for d in due:
            # Anchor the next run off the *scheduled* time, not `now`, so interval
            # schedules don't drift forward by the poll latency each cycle. If that
            # lands in the past (missed runs), recompute from now to avoid bursting.
            nxt = compute_next_run(d.schedule_type, d.schedule_value, d.next_run_at)
            if nxt is not None and nxt <= now:
                nxt = compute_next_run(d.schedule_type, d.schedule_value, now)
            if nxt is None:
                logger.warning(
                    "discovery %s has invalid %s schedule_value=%r — skipping",
                    d.id, d.schedule_type, d.schedule_value,
                )
                continue

            message = {
                "type": "asm",
                "user_id": d.user_id,
                "id": d.id,
                "asset_type": d.asset_type,
                "target_source": d.target_source,
                "intensity": d.intensity,
            }
            if await publish_message(QUEUE, message):
                d.status = "PENDING"
                d.last_run_at = now
                d.next_run_at = nxt
                d.updated_at = now
                scheduled += 1
                started.append({"id": d.id, "org_id": d.org_id, "user_id": d.user_id, "name": d.name})
                logger.info("rescheduled discovery %s; next_run_at=%s", d.id, d.next_run_at)
            else:
                logger.error("failed to enqueue scheduled discovery %s", d.id)

        await db.commit()

        # Emit notifications AFTER the tick commits (dispatch runs its own txn on
        # this session). Best-effort — a notification failure never breaks a tick.
        await _emit_schedule_events(db, started, reaped)

        # 3) Auto-score assets from real scan data (Phase E) so the dashboard's
        #    risk numbers populate automatically after a scan — no manual rescore.
        try:
            await _auto_score_assets(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("auto-score pass failed: %s", exc)

        # 4) Fire due scheduled reports so recurring reports actually generate.
        try:
            await _run_due_scheduled_reports(db, now)
        except Exception as exc:  # noqa: BLE001
            logger.warning("scheduled-report pass failed: %s", exc)

    return scheduled


async def _run_due_scheduled_reports(db, now: datetime, limit: int = 50) -> int:
    """Generate reports for enabled schedules whose next_run_at is due."""
    from models.report_models import ScheduledReport
    from routes.reports import generate_scheduled_report

    due = (
        await db.execute(
            select(ScheduledReport).where(
                ScheduledReport.enabled.is_(True),
                ScheduledReport.next_run_at.isnot(None),
                ScheduledReport.next_run_at <= now,
                ScheduledReport.org_id.isnot(None),
            ).limit(limit)
        )
    ).scalars().all()

    generated = 0
    for sched in due:
        try:
            await generate_scheduled_report(db, sched)
            generated += 1
            logger.info("generated scheduled report %s (%s)", sched.id, sched.name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to generate scheduled report %s: %s", sched.id, exc)
    return generated


async def scheduler_loop(poll_seconds: int = POLL_SECONDS) -> None:
    logger.info(
        "ASM scheduler started (poll every %ss, stale-reap %sm, cron=%s)",
        poll_seconds, STALE_RUNNING_MINUTES, _HAS_CRONITER,
    )
    while True:
        try:
            n = await _tick()
            if n:
                logger.info("scheduler tick: %d discovery(ies) re-enqueued", n)
        except asyncio.CancelledError:
            logger.info("ASM scheduler stopping")
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("scheduler tick failed: %s", exc)
        await asyncio.sleep(poll_seconds)

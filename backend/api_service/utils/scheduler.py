"""
Background scheduler — a thin tick loop over the modules' due-work functions.

A lightweight async loop (started in `main.py`) that each tick:
  1. runs the ASM tick (stale-RUNNING reaping + due recurring discoveries) —
     asm/service.py,
  2. runs the VS tick (stale reaping + due recurring scans) — vs/service.py,
  3. auto-scores assets and freshly discovered IPs from real scan data,
  4. generates due scheduled reports (reports_service.py),
  5. re-evaluates due CA orgs (ca/engine.py),
  6. refreshes VS CVE intelligence ~daily and writes daily VS trend snapshots
     (fire-and-forget, guarded by process-local state).

The loop is crash-tolerant (a failing tick logs and retries) and idempotent:
due-row claiming uses FOR UPDATE SKIP LOCKED inside each module's tick, so two
API replicas can't double-enqueue.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import select

from utils.database import AsyncSessionLocal
from utils.schedule_math import (  # pure math, dependency-free + unit-tested
    parse_interval,
    next_cron,
    compute_next_run,
    _HAS_CRONITER,
)

logger = logging.getLogger("cybersentinel.scheduler")

POLL_SECONDS = int(os.getenv("ASM_SCHEDULER_POLL_SECONDS", "60"))

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


async def _tick() -> int:
    """One scheduler pass: reap + enqueue + score + report + evaluate."""
    from asm import service as asm_service
    from vs import service as vs_service

    scheduled = 0
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()

        # 1) ASM: reap stale runs, then re-enqueue due recurring discoveries.
        scheduled = await asm_service.tick_due_discoveries(db, now, STALE_RUNNING_MINUTES)

        # 2) VS: due recurring scans — same overlap-prevention + SKIP LOCKED
        #    discipline, enqueued to jobs.vs.
        try:
            await vs_service.tick_due_scans(db, now, STALE_RUNNING_MINUTES)
        except Exception as exc:  # noqa: BLE001
            logger.warning("VS scheduled-scan pass failed: %s", exc)

        # 3) Auto-score assets from real scan data so the dashboard's risk
        #    numbers populate automatically after a scan — no manual rescore.
        try:
            await asm_service.auto_score_assets(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("auto-score pass failed: %s", exc)

        # 3b) Score freshly discovered IPs with the same defensible model so the
        #     IP surface and the Exposure tab agree (retires the Go heuristic).
        try:
            await asm_service.score_discovered_ips(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("IP scoring pass failed: %s", exc)

        # 4) Fire due scheduled reports so recurring reports actually generate.
        try:
            await _run_due_scheduled_reports(db, now)
        except Exception as exc:  # noqa: BLE001
            logger.warning("scheduled-report pass failed: %s", exc)

        # 4b) Continuous compliance (CA) evaluation for orgs whose evidence is
        #     due a freshness pass. Event-driven hooks (VS/ASM ingest) handle
        #     real-time updates; this tick handles time-based evidence decay.
        try:
            await _run_due_ca_evaluations(db, now)
        except Exception as exc:  # noqa: BLE001
            logger.warning("CA evaluation pass failed: %s", exc)

        # 4c) Auto-verify domain ownership: a customer who added the DNS TXT
        #     record — and maybe closed the tab — gets flipped to verified here
        #     within one tick, so nobody has to sit and click "check again".
        try:
            await _recheck_pending_ownership(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ownership re-check pass failed: %s", exc)

    # 5) Refresh VS CVE intelligence (KEV/EPSS/NVD) ~daily, off the tick's
    #    session and non-blocking so a slow feed can't stall scheduling.
    _maybe_launch_cve_sync(now)

    # 6) Daily VS trend snapshot — fire-and-forget (must not block the tick) and
    #    the once-per-day guard is set UPFRONT so a slow/failing pass can't rerun
    #    every 60s for the rest of the day.
    global _last_trend_snapshot_date, _trend_task
    _day = now.strftime("%Y-%m-%d")
    if _last_trend_snapshot_date != _day and (_trend_task is None or _trend_task.done()):
        _last_trend_snapshot_date = _day
        _trend_task = asyncio.create_task(_run_trend_snapshot(now))

    return scheduled


async def _run_trend_snapshot(now: datetime) -> None:
    from vs import service as vs_service
    try:
        async with AsyncSessionLocal() as sdb:
            await vs_service.snapshot_trends(sdb, now)
    except Exception as exc:  # noqa: BLE001
        logger.warning("VS trend snapshot pass failed: %s", exc)


# --- VS CVE intelligence refresh (daily, fire-and-forget) ------------------
_last_cve_sync: datetime | None = None
_cve_sync_task: "asyncio.Task | None" = None
_CVE_SYNC_INTERVAL = timedelta(hours=int(os.getenv("VS_CVE_SYNC_HOURS", "20")))


_last_trend_snapshot_date: str | None = None
_trend_task: "asyncio.Task | None" = None


async def _run_cve_sync() -> None:
    global _last_cve_sync
    try:
        from utils.cve_feeds import sync_all
        async with AsyncSessionLocal() as db:
            res = await sync_all(db)
        logger.info("VS CVE intel sync complete: %s", res)
    except Exception as exc:  # noqa: BLE001
        logger.warning("VS CVE intel sync failed: %s", exc)
    finally:
        _last_cve_sync = datetime.utcnow()


def _maybe_launch_cve_sync(now: datetime) -> None:
    global _cve_sync_task
    due = _last_cve_sync is None or (now - _last_cve_sync) > _CVE_SYNC_INTERVAL
    if due and (_cve_sync_task is None or _cve_sync_task.done()):
        _cve_sync_task = asyncio.create_task(_run_cve_sync())


async def _run_due_scheduled_reports(db, now: datetime, limit: int = 50) -> int:
    """Generate reports for enabled schedules whose next_run_at is due."""
    from models.report_models import ScheduledReport
    from reports_service import generate_scheduled_report

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


async def _run_due_ca_evaluations(db, now: datetime, batch: int = 10) -> int:
    """Re-evaluate compliance posture for orgs whose next_eval_at is due.
    SKIP LOCKED keeps multi-replica deployments from double-evaluating.
    evaluate_org advances next_eval_at itself (+6h)."""
    from models.ca_models import CaOrgFramework
    from ca.engine import evaluate_org

    # NOTE: DISTINCT is incompatible with FOR UPDATE in Postgres — lock the
    # enablement rows, dedupe org ids in Python.
    due_rows = (
        await db.execute(
            select(CaOrgFramework.org_id)
            .where(
                CaOrgFramework.status == "active",
                (CaOrgFramework.next_eval_at.is_(None)) | (CaOrgFramework.next_eval_at <= now),
            )
            .limit(batch)
            .with_for_update(skip_locked=True)
        )
    ).scalars().all()
    n = 0
    for org_id in dict.fromkeys(due_rows):
        try:
            result = await evaluate_org(db, org_id, reason="scheduler")
            await db.commit()
            if result.get("evaluated"):
                n += 1
        except Exception as exc:  # noqa: BLE001 — one org's failure must not block the rest
            logger.warning("CA evaluation failed for org %s: %s", org_id, exc)
            await db.rollback()
    return n


async def _recheck_pending_ownership(db, batch: int = 50) -> int:
    """Auto-verify domains whose DNS TXT record has appeared.

    Picks domain assets that have a verification token but aren't verified yet,
    re-resolves their TXT record, and flips ownership_verified when it matches —
    so a customer who added the record and left still gets verified within a tick.
    """
    from models.asset_models import Asset
    from utils.ownership_verify import domain_txt_matches

    pending = (
        await db.execute(
            select(Asset).where(
                Asset.type == "domain",
                Asset.ownership_verified.is_(False),
                Asset.verification_token.isnot(None),
            ).limit(batch)
        )
    ).scalars().all()

    verified = 0
    for a in pending:
        try:
            if await domain_txt_matches(a.name, a.verification_token):
                a.ownership_verified = True
                verified += 1
                logger.info("ownership auto-verified: %s (%s)", a.name, a.id)
        except Exception as exc:  # noqa: BLE001 — one asset's DNS failure must not block others
            logger.debug("ownership re-check failed for %s: %s", a.name, exc)
    if verified:
        await db.commit()
    return verified


async def scheduler_loop(poll_seconds: int = POLL_SECONDS) -> None:
    logger.info(
        "scheduler started (poll every %ss, stale-reap %sm, cron=%s)",
        poll_seconds, STALE_RUNNING_MINUTES, _HAS_CRONITER,
    )
    while True:
        try:
            n = await _tick()
            if n:
                logger.info("scheduler tick: %d discovery(ies) re-enqueued", n)
        except asyncio.CancelledError:
            logger.info("scheduler stopping")
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("scheduler tick failed: %s", exc)
        await asyncio.sleep(poll_seconds)

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
from datetime import datetime, timedelta, timezone

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


async def _run_due_vs_scans(db, now: datetime) -> int:
    """Enqueue due recurring VS scans (INTERVAL/CRON). Mirrors the ASM due-scan
    discipline: FOR UPDATE SKIP LOCKED, overlap prevention (skip RUNNING/PAUSED/
    DELETED), and only ownership-verified + SSRF-safe targets are scanned."""
    from models.vs_models import VsScan, VsScanRun, VsScanTarget, VsScanProfile
    from models.asset_models import Asset as AssetModel
    from utils.target_guard import validate_scan_target

    # Reap crashed VS scans (stuck RUNNING past the stale window) so they can re-run.
    cutoff = now - timedelta(minutes=STALE_RUNNING_MINUTES)
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
        message = {
            "type": "vs", "id": run.id, "scan_id": scan.id, "org_id": scan.org_id,
            "profile": prof.to_dict() if prof else {},
            "targets": [{"asset_id": a.id, "host": a.name} for a in safe],
        }
        if await publish_message("jobs.vs", message):
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


# severity (5 bands) -> AsmIP.exposure_level (3 bands the UI renders)
_IP_LEVEL = {"critical": "high", "high": "high", "medium": "medium", "low": "low", "info": "low"}


async def _score_discovered_ips(db, limit: int = 2000) -> int:
    """Score discovered AsmIP rows with the SINGLE defensible model
    (scoring/exposure.py) and persist exposure_score/level/explanation.

    This retires the legacy Go magic-number: the worker no longer computes an IP
    score, so the number shown on the IP surface now comes from the same model as
    the Exposure tab. Selection is keyed off `score_explanation IS NULL` — the
    model always writes its factor breakdown there, so a freshly discovered IP (or
    one left unscored by the old heuristic) is picked up exactly once per state."""
    from models.asm_models import AsmIP, AsmPort, AsmSSLCert
    from scoring import score_exposure, AssetSignals

    ips = (await db.execute(
        select(AsmIP).where(AsmIP.score_explanation.is_(None)).limit(limit)
    )).scalars().all()
    if not ips:
        return 0

    disc_ids = list({ip.asm_discovery_id for ip in ips})
    ports = (await db.execute(
        select(AsmPort).where(
            AsmPort.asm_discovery_id.in_(disc_ids), AsmPort.status == "open")
    )).scalars().all()
    ports_by: dict[tuple, list[int]] = {}
    svc_by: dict[tuple, list[str]] = {}
    for p in ports:
        k = (p.asm_discovery_id, p.ip_address)
        ports_by.setdefault(k, []).append(p.port)
        if p.service:
            svc_by.setdefault(k, []).append(p.service)

    certs = (await db.execute(
        select(AsmSSLCert).where(AsmSSLCert.asm_discovery_id.in_(disc_ids))
    )).scalars().all()
    now = datetime.utcnow()
    tls_by: dict[tuple, list[str]] = {}
    for c in certs:
        if c.valid_until and c.valid_until < now:
            tls_by.setdefault((c.asm_discovery_id, c.host), []).append("expired")

    scored = 0
    for ip in ips:
        k = (ip.asm_discovery_id, ip.ip_address)
        sc = score_exposure(AssetSignals(
            open_ports=ports_by.get(k, []),
            services=svc_by.get(k, []),
            is_public=True,                 # externally-discovered = internet-facing
            tls_issues=tls_by.get(k, []),
            asset_criticality="normal",
        ))
        ip.exposure_score = sc.score
        ip.exposure_level = _IP_LEVEL.get(sc.severity, "low")
        ip.score_explanation = sc.to_dict().get("factors")
        scored += 1
    await db.commit()
    if scored:
        logger.info("scored %d discovered IP(s) with the exposure model", scored)
    return scored


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

        # 2b) Due recurring VS (vulnerability) scans — same overlap-prevention +
        #     SKIP LOCKED discipline, enqueued to jobs.vs.
        try:
            await _run_due_vs_scans(db, now)
        except Exception as exc:  # noqa: BLE001
            logger.warning("VS scheduled-scan pass failed: %s", exc)

        # 3) Auto-score assets from real scan data (Phase E) so the dashboard's
        #    risk numbers populate automatically after a scan — no manual rescore.
        try:
            await _auto_score_assets(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("auto-score pass failed: %s", exc)

        # 3b) Score freshly discovered IPs with the same defensible model so the
        #     IP surface and the Exposure tab agree (retires the Go heuristic).
        try:
            await _score_discovered_ips(db)
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
    try:
        async with AsyncSessionLocal() as sdb:
            await _snapshot_vs_trends(sdb, now)
    except Exception as exc:  # noqa: BLE001
        logger.warning("VS trend snapshot pass failed: %s", exc)


# --- VS CVE intelligence refresh (daily, fire-and-forget) ------------------
_last_cve_sync: datetime | None = None
_cve_sync_task: "asyncio.Task | None" = None
_CVE_SYNC_INTERVAL = timedelta(hours=int(os.getenv("VS_CVE_SYNC_HOURS", "20")))


_last_trend_snapshot_date: str | None = None
_trend_task: "asyncio.Task | None" = None


async def _snapshot_vs_trends(db, now: datetime) -> int:
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

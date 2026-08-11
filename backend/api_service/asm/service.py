"""ASM domain service.

Business logic for the ASM module: tenancy predicates shared by the route
layer, the single place the `jobs.asm` queue envelope is built, a generic
child-table list helper, and the scheduler tick (stale-run reaping, due
recurring discoveries, asset/IP auto-scoring).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import false as sql_false
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.asm_models import AsmDiscovery
from models.asset_models import Asset
from utils.database import AsyncSessionLocal
from utils.queue import publish_message  # noqa: F401 (legacy; retained for reference)
from utils.scan_publish import publish_scan_job
from utils.schedule_math import compute_next_run

logger = logging.getLogger("cybersentinel.asm")


def _naive(dt):
    """Drop tzinfo so tz-aware and naive datetimes compare cleanly (naive UTC).
    Asset.last_scored_at is TZ-aware while other timestamps here are naive."""
    return dt.replace(tzinfo=None) if dt is not None and dt.tzinfo is not None else dt

QUEUE = "jobs.asm"


# ---------------------------------------------------------------------------
# Tenancy
# ---------------------------------------------------------------------------
def org_filter(model, user):
    """Tenant-scoping predicate for ASM owner models (discoveries, runs, assets).

    Scans MUST be isolated by `org_id`, not by the set of member user-ids. The
    old `user_id.in_(org_members)` approach leaked a member's historical scan
    data across orgs: an ASM row keeps the `org_id` it was created under, but if
    that member later joins another org their `user_id` enters the new org's
    member set and their old rows matched. Scoping on `org_id` fixes that. When
    there is no org context, fall back to the caller's own rows only.
    """
    if user.org_id:
        return model.org_id == user.org_id
    if user.user_id:
        return model.user_id == user.user_id
    return sql_false()


async def user_discovery_ids(db: AsyncSession, user) -> list[str]:
    # Org-scoped so child data (IPs, ports, SSL, subdomains) routed through these
    # discovery ids inherits correct tenant isolation.
    disc_query = select(AsmDiscovery.id).where(org_filter(AsmDiscovery, user))
    disc_result = await db.execute(disc_query)
    return [row[0] for row in disc_result.all()]


# ---------------------------------------------------------------------------
# Queue envelope — the ONLY place a jobs.asm message is built. The field set
# is a cross-language contract with the Go worker (consumer/asm/job.go).
# ---------------------------------------------------------------------------
def build_job_message(discovery: AsmDiscovery) -> dict:
    return {
        "type": "asm",
        "user_id": discovery.user_id,
        "id": discovery.id,
        "asset_type": discovery.asset_type,
        "target_source": discovery.target_source,
        "intensity": discovery.intensity,
    }


async def _resolve_targets(discovery: AsmDiscovery) -> list[str]:
    """Resolve the concrete scan targets (domain names / IPs) for the worker.
    MANUAL_ENTRY uses manual_targets; FROM_ASSET resolves asset names."""
    if discovery.target_source == "MANUAL_ENTRY":
        mt = discovery.manual_targets or []
        return [str(t).strip() for t in mt if str(t).strip()] if isinstance(mt, list) else []
    ids = discovery.asset_ids or []
    if not isinstance(ids, list) or not ids:
        return []
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Asset.name).where(Asset.id.in_(ids)))).all()
    return [r[0] for r in rows if r[0]]


async def enqueue_discovery(discovery: AsmDiscovery) -> bool:
    """Publish an ASM scan to the redesigned per-priority queue (asm.<priority>).

    task_id IS the discovery id, so the reporting consumer writes findings with
    asm_discovery_id = task_id. NOTE: a multi-asset discovery runs as ONE pipeline;
    findings attribute to the first asset_id (single-asset is the common case).
    """
    targets = await _resolve_targets(discovery)
    ids = discovery.asset_ids if isinstance(discovery.asset_ids, list) else []
    return await publish_scan_job(
        type="asm",
        priority="medium",
        task_id=discovery.id,
        org_id=discovery.org_id,
        asset_id=(ids[0] if ids else ""),
        targets=targets,
        mode=discovery.intensity or "NORMAL",
        config={
            "asset_type": discovery.asset_type,
            "target_source": discovery.target_source,
            "user_id": discovery.user_id,
        },
    )


# ---------------------------------------------------------------------------
# Generic child-table list helper — collapses the near-identical
# join/filter/ilike/sort-whitelist/count/paginate bodies of the child-table
# list endpoints. Filters, search columns and sort whitelists are passed by
# each endpoint so its exact query semantics are preserved.
# ---------------------------------------------------------------------------
async def list_child_rows(
    db: AsyncSession, user, model, *,
    page: int, page_size: int,
    filters: dict | None = None,
    q: str | None = None, search_cols=(),
    sort_by: str | None = None, sort_dir: str | None = "desc",
    sort_cols: dict | None = None, default_sort_col=None,
):
    """List rows of an ASM child table scoped through its discovery join.

    `filters`: {column: value} equality filters (applied only for truthy values,
    matching the previous inline `if param:` behaviour).
    `sort_cols`: whitelist mapping sort_by value -> column.
    Returns (rows, total).
    """
    base = (
        select(model)
        .join(AsmDiscovery, model.asm_discovery_id == AsmDiscovery.id)
        .where(org_filter(AsmDiscovery, user))
    )
    for col, val in (filters or {}).items():
        if val:
            base = base.where(col == val)
    if q and search_cols:
        like = f"%{q}%"
        base = base.where(or_(*[c.ilike(like) for c in search_cols]))

    sort_col = default_sort_col if default_sort_col is not None else model.created_at
    if sort_cols and sort_by in sort_cols:
        sort_col = sort_cols[sort_by]
    sort_col = sort_col.desc() if (sort_dir or "desc").lower() == "desc" else sort_col.asc()

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(
        base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return rows, total


# ---------------------------------------------------------------------------
# Scheduler tick — stale-run reaping + due recurring discoveries + scoring.
# ---------------------------------------------------------------------------
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


async def _reap_stale(db, now: datetime, stale_minutes: int) -> list[dict]:
    """Mark crashed (stale-RUNNING) discoveries FAILED so they aren't stranded.

    Returns lightweight descriptors of the reaped discoveries so the caller can
    emit a 'scan failed' notification for each (after the tick commits)."""
    cutoff = now - timedelta(minutes=stale_minutes)
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
    logger.warning("reaped %d stale RUNNING discovery(ies) older than %dm", len(stale), stale_minutes)
    return [
        {"id": r[0], "org_id": r[1], "user_id": r[2], "name": r[3]}
        for r in stale
    ]


async def tick_due_discoveries(db, now: datetime, stale_minutes: int) -> int:
    """Reap stale ASM runs, then re-enqueue due recurring discoveries.

    FOR UPDATE SKIP LOCKED so that with multiple API replicas running this loop,
    each due row is claimed by exactly one replica for this tick — otherwise two
    replicas SELECT the same COMPLETED row and double-enqueue."""
    reaped = await _reap_stale(db, now, stale_minutes)
    started: list[dict] = []
    scheduled = 0

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

        if await enqueue_discovery(d):
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
    return scheduled


# severity (5 bands) -> AsmIP.exposure_level (3 bands the UI renders)
_IP_LEVEL = {"critical": "high", "high": "high", "medium": "medium", "low": "low", "info": "low"}


async def score_discovered_ips(db, limit: int = 2000) -> int:
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


async def auto_score_assets(db, limit: int = 200) -> int:
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
    from models.asset_models import Asset as AssetModel
    from scoring import score_exposure
    from scoring.asset_signals import _gather_asset_signals

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
            # Asset.last_scored_at is TZ-aware, AsmDiscovery.updated_at is naive —
            # compare on a common (naive-UTC) basis to avoid a mixed-tz TypeError.
            if newest and a.last_scored_at and _naive(a.last_scored_at) < _naive(newest) and a.id not in already:
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
        asset.risk_factors = [
            {"name": f.name, "points": round(f.points, 1), "detail": f.detail}
            for f in result.factors
        ]
        asset.last_scored_at = datetime.utcnow()
        scored += 1

    if scored:
        await db.commit()
        logger.info("auto-scored %d asset(s) from real ASM scan data", scored)
    return scored

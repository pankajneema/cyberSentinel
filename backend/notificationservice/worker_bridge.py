"""
Bridge: Go worker scan-lifecycle events -> notifications.

The Go worker publishes small JSON events to the Redis channel
`asm:worker:events` at scan start / completion / failure. Every API replica
subscribes, but a cross-replica dedup lock ensures the side-effecting dispatch
(persist + email + Slack) runs exactly once; realtime fan-out then reaches all
replicas' sockets via the normal `rt:events` path inside `dispatch()`.
"""
from __future__ import annotations

import asyncio
import json
import logging

from sqlalchemy import select, func

from utils.database import AsyncSessionLocal
from models.asm_models import AsmDiscovery, AsmSubdomain, AsmIP
from notificationservice import dispatcher
from notificationservice import events as ev

logger = logging.getLogger(__name__)

WORKER_CHANNEL = "asm:worker:events"

# Only terminal events come from the worker. "started" is emitted by the API at
# enqueue time (see routes/asm.py + scheduler), so it is intentionally absent
# here to avoid a duplicate start notification.
_EVENT_MAP = {
    "completed": (ev.SCAN_COMPLETED, "info", "Discovery completed"),
    "failed": (ev.SCAN_FAILED, "high", "Discovery failed"),
}


async def _handle(raw: dict) -> None:
    discovery_id = raw.get("discovery_id") or raw.get("id")
    kind = raw.get("event")
    if not discovery_id or kind not in _EVENT_MAP:
        return
    event_id = raw.get("event_id") or f"{discovery_id}:{kind}"

    # Exactly-once across replicas.
    if not await dispatcher.acquire_once(f"worker:{event_id}", ttl_seconds=1800):
        return

    event_type, severity, label = _EVENT_MAP[kind]
    async with AsyncSessionLocal() as db:
        disc = (
            await db.execute(select(AsmDiscovery).where(AsmDiscovery.id == discovery_id))
        ).scalar_one_or_none()
        if not disc or not disc.org_id:
            return

        name = disc.name or disc.id
        title = f"{label}: {name}"
        body = ""
        high_count = 0
        if kind == "completed":
            subs = (await db.execute(
                select(func.count()).select_from(AsmSubdomain).where(
                    AsmSubdomain.asm_discovery_id == discovery_id)
            )).scalar() or 0
            ips = (await db.execute(
                select(func.count()).select_from(AsmIP).where(
                    AsmIP.asm_discovery_id == discovery_id)
            )).scalar() or 0
            high_count = (await db.execute(
                select(func.count()).select_from(AsmIP).where(
                    AsmIP.asm_discovery_id == discovery_id,
                    AsmIP.exposure_level == "high")
            )).scalar() or 0
            body = f"{subs} subdomains, {ips} hosts discovered."
            if high_count:
                body += f" {high_count} high-exposure host(s)."
        elif kind == "failed":
            body = raw.get("error") or "The scan ended in a failed state."

        await dispatcher.dispatch(
            db, disc.org_id, event_type, title, body=body, severity=severity,
            link=f"/app/asm?discovery={discovery_id}",
            meta={"discovery_id": discovery_id},
            owner_user_id=disc.user_id,
        )

        # Separate, channel-gated alert for high-exposure findings so the
        # `high_exposure` notification rule (Slack/email) actually fires.
        if high_count:
            await dispatcher.dispatch(
                db, disc.org_id, ev.FINDING_HIGH,
                title=f"{high_count} high-exposure host(s): {name}",
                body="Review the newly discovered high-exposure hosts.",
                severity="high",
                link=f"/app/asm?discovery={discovery_id}",
                meta={"discovery_id": discovery_id, "high_count": high_count},
                owner_user_id=disc.user_id,
            )


async def run_worker_event_subscriber(stop_event: asyncio.Event | None = None) -> None:
    """Background task: consume worker events from Redis and dispatch them."""
    from utils.redis_client import get_redis

    while stop_event is None or not stop_event.is_set():
        pubsub = None
        try:
            redis = await get_redis()
            if redis is None:
                await asyncio.sleep(5)
                continue
            pubsub = redis.pubsub()
            await pubsub.subscribe(WORKER_CHANNEL)
            logger.info("worker-event subscriber listening on %s", WORKER_CHANNEL)
            async for msg in pubsub.listen():
                if msg is None or msg.get("type") != "message":
                    continue
                try:
                    raw = json.loads(msg["data"])
                except (ValueError, TypeError):
                    continue
                try:
                    await _handle(raw)
                except Exception as e:  # noqa: BLE001
                    logger.warning("worker event handling failed: %s", e)
            # Clean listen() exit — back off before reconnecting.
            await asyncio.sleep(2)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning("worker-event subscriber error, retrying in 5s: %s", e)
            await asyncio.sleep(5)
        finally:
            if pubsub is not None:
                try:
                    await pubsub.aclose()
                except Exception:  # noqa: BLE001
                    pass

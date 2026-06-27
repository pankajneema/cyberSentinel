"""
Recurring discovery scheduler.

A lightweight async background loop (started in `main.py`) that re-runs ASM
discoveries on their interval. It:
  1. finds INTERVAL discoveries whose `next_run_at` is due and aren't currently
     RUNNING,
  2. re-publishes the job to `jobs.asm` (same payload as manual creation),
  3. sets status back to PENDING and computes the next `next_run_at`.

QUICK discoveries run once and are never rescheduled. The loop is crash-tolerant
(a failing tick logs and retries) and idempotent (a job already RUNNING is
skipped).
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select

from utils.database import AsyncSessionLocal
from utils.queue import publish_message
from models.asm_models import AsmDiscovery

logger = logging.getLogger("cybersentinel.scheduler")

POLL_SECONDS = 60
QUEUE = "jobs.asm"
_INTERVAL_RE = re.compile(r"^\s*(\d+)\s*([mhd])\s*$", re.IGNORECASE)


def parse_interval(value: Optional[str]) -> Optional[timedelta]:
    """Parse '5h' / '30m' / '1d' / '24h' into a timedelta. None if invalid."""
    if not value:
        return None
    m = _INTERVAL_RE.match(value)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2).lower()
    if n <= 0:
        return None
    return {"m": timedelta(minutes=n), "h": timedelta(hours=n), "d": timedelta(days=n)}[unit]


async def _tick() -> int:
    """Re-enqueue all due recurring discoveries. Returns how many were scheduled."""
    scheduled = 0
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()
        due = (
            await db.execute(
                select(AsmDiscovery).where(
                    AsmDiscovery.schedule_type == "INTERVAL",
                    AsmDiscovery.next_run_at.isnot(None),
                    AsmDiscovery.next_run_at <= now,
                    AsmDiscovery.status != "RUNNING",
                )
            )
        ).scalars().all()

        for d in due:
            interval = parse_interval(d.schedule_value)
            if interval is None:
                logger.warning("discovery %s has invalid schedule_value=%r — skipping", d.id, d.schedule_value)
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
                d.next_run_at = now + interval
                d.updated_at = now
                scheduled += 1
                logger.info("rescheduled discovery %s; next_run_at=%s", d.id, d.next_run_at)
            else:
                logger.error("failed to enqueue scheduled discovery %s", d.id)

        if scheduled:
            await db.commit()
    return scheduled


async def scheduler_loop(poll_seconds: int = POLL_SECONDS) -> None:
    logger.info("ASM scheduler started (poll every %ss)", poll_seconds)
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

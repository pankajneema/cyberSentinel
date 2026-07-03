"""Pure scheduling math for ASM discoveries — no DB, no queue, no framework deps.

Kept dependency-free (stdlib + optional croniter) so it can be imported by the
routes, the scheduler loop, and unit tests without pulling in SQLAlchemy/aio_pika.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger("cybersentinel.schedule_math")

_INTERVAL_RE = re.compile(r"^\s*(\d+)\s*([mhd])\s*$", re.IGNORECASE)

try:
    from croniter import croniter  # type: ignore
    _HAS_CRONITER = True
except Exception:  # noqa: BLE001
    croniter = None  # type: ignore
    _HAS_CRONITER = False


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


def next_cron(expr: Optional[str], base: datetime) -> Optional[datetime]:
    """Next fire time for a 5-field CRON expression after `base`. None if invalid."""
    if not expr:
        return None
    if not _HAS_CRONITER:
        logger.warning("CRON schedule requested but croniter not installed: %r", expr)
        return None
    try:
        if not croniter.is_valid(expr):  # type: ignore[attr-defined]
            return None
        return croniter(expr, base).get_next(datetime)  # type: ignore[misc]
    except Exception as exc:  # noqa: BLE001
        logger.warning("invalid CRON expr %r: %s", expr, exc)
        return None


def compute_next_run(schedule_type: Optional[str], schedule_value: Optional[str],
                     base: datetime) -> Optional[datetime]:
    """When should a discovery next run after `base`?

    Returns None for QUICK / unknown / invalid schedules (no recurrence).
    """
    if schedule_type == "INTERVAL":
        interval = parse_interval(schedule_value)
        return base + interval if interval else None
    if schedule_type == "CRON":
        return next_cron(schedule_value, base)
    return None

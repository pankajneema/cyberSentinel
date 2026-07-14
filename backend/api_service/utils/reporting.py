"""Shared runtime for the scan-pipeline reporting consumers (asm/vs/ca).

Lives in the shared utils home so the reporting package stays just its three
service folders. Two responsibilities:

  * bootstrap() — resolve the bare-vs-prefixed model import clash. The codebase
    mixes styles (dispatcher.py imports models bare; ingest.py imports them
    prefixed); loaded under two names the same modules re-register their tables
    on the shared SQLAlchemy Base -> "Table 'organizations' is already defined".
    We import each model once (prefixed) and alias backend.api_service.X -> bare
    X in sys.modules. Call it BEFORE importing any consumer module.
  * notify_scan() — the standard scan.completed / scan.failed notification.

Model-free at import time (queue/database only), so importing this before
bootstrap() is safe; notify_scan imports the dispatcher lazily (after bootstrap).
"""

from __future__ import annotations

import importlib
import logging
import sys

from utils.database import AsyncSessionLocal
from utils.queue import consume_messages

logger = logging.getLogger("cybersentinel.reporting")

_MODELS = (
    "models.tenancy_models",
    "models.notification_models",
    "models.asset_models",
    "models.asm_models",
    "models.vs_models",
    "models.ca_models",
)
_bootstrapped = False


def bootstrap() -> None:
    """Register every model once and alias prefixed<->bare module names."""
    global _bootstrapped
    if _bootstrapped:
        return
    for m in _MODELS:
        importlib.import_module("backend.api_service." + m)
    for full in list(sys.modules):
        if full.startswith("backend.api_service."):
            bare = full[len("backend.api_service."):]
            sys.modules.setdefault(bare, sys.modules[full])
    _bootstrapped = True


async def notify_scan(org_id: str | None, *, service: str, task_id: str | None,
                      status: str, extra: str = "") -> None:
    """Fire the standard scan.completed / scan.failed notification for a terminal."""
    if not org_id:
        return
    from notificationservice import dispatcher  # lazy: pulls models bare
    from notificationservice import events as ev

    completed = status == "COMPLETED"
    body = f"{service.upper()} task {task_id} {status.lower()}."
    if extra:
        body = f"{body} {extra}"
    async with AsyncSessionLocal() as db:
        await dispatcher.dispatch(
            db, org_id,
            ev.SCAN_COMPLETED if completed else ev.SCAN_FAILED,
            title=f"{service.upper()} scan {status.lower()}",
            body=body,
            severity="info" if completed else "high",
            meta={"task_id": task_id, "service": service},
        )

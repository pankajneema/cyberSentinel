"""Publish scan jobs to the redesigned per-service priority queues.

Additive: this is the new intake path (unified job message → asm/vs/ca.<priority>
queues consumed by the Go worker). The legacy per-module publishers
(asm/service.py → jobs.asm, vs/service.py → jobs.vs) are left in place; cutting
intake over to publish_scan_job is a deliberate, separate step (it only works
once the redesigned worker is the deployed consumer).
"""

from __future__ import annotations

from typing import Any, Optional

from utils.queue import publish_message
from utils.scan_contracts import build_job_message, job_queue


async def publish_scan_job(
    *,
    type: str,
    priority: str,
    task_id: str,
    org_id: str,
    asset_id: Optional[str] = None,
    targets: Optional[list[str]] = None,
    mode: str = "NORMAL",
    config: Optional[dict[str, Any]] = None,
) -> bool:
    """Publish one unified scan job to <type>.<priority>. Returns False on failure."""
    msg = build_job_message(
        type=type, priority=priority, task_id=task_id, org_id=org_id,
        asset_id=asset_id, targets=targets, mode=mode, config=config,
    )
    return await publish_message(job_queue(type, priority), msg)

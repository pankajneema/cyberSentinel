"""Internal scan enqueue endpoint — publishes a unified job to the redesigned
per-service priority queues. Guarded by X-Internal-Token (= CONTROL_PLANE_TOKEN),
the same shared secret used by the worker's credential fetch. Intended for the
scheduler/intake and for end-to-end testing of the new pipeline without touching
the legacy jobs.asm/jobs.vs publishers.
"""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from utils.scan_publish import publish_scan_job
from utils.scan_contracts import PRIORITIES, SERVICES

logger = logging.getLogger("cybersentinel.internal_scans")
router = APIRouter(prefix="/api/v1/internal/scans", tags=["Internal (scans)"])


async def _require_internal_token(x_internal_token: str = Header(default="")):
    expected = os.getenv("CONTROL_PLANE_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="internal token not configured")
    if not hmac.compare_digest(x_internal_token or "", expected):
        raise HTTPException(status_code=401, detail="unauthorized")


class EnqueueRequest(BaseModel):
    type: str
    task_id: str
    org_id: str
    priority: str = "medium"
    asset_id: str | None = None
    targets: list[str] = []
    mode: str = "NORMAL"
    config: dict = {}


@router.post("/enqueue", dependencies=[Depends(_require_internal_token)])
async def enqueue_scan(payload: EnqueueRequest):
    if payload.type not in SERVICES:
        raise HTTPException(status_code=400, detail=f"invalid type; expected one of {SERVICES}")
    if payload.priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail=f"invalid priority; expected one of {PRIORITIES}")
    ok = await publish_scan_job(
        type=payload.type, priority=payload.priority, task_id=payload.task_id,
        org_id=payload.org_id, asset_id=payload.asset_id, targets=payload.targets,
        mode=payload.mode, config=payload.config,
    )
    if not ok:
        raise HTTPException(status_code=502, detail="enqueue failed (broker unavailable)")
    return {"enqueued": True, "queue": f"{payload.type}.{payload.priority}", "task_id": payload.task_id}

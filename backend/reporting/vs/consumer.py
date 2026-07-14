"""VS reporting consumer — persists vulnerability findings via the existing
ingest pipeline (dedup / risk / lifecycle).

Consumes ``reporting.vs``. VS findings arrive per stage but ingest_vs_result
needs the whole run at once, so they're buffered per task_id and ingested on the
terminal. ingest_vs_result fires its own scan.completed notification, so this
consumer does NOT notify again (avoids a double notification).

In-memory buffer: a consumer restart drops buffered findings for in-flight scans.
"""

from __future__ import annotations

from typing import Any

from backend.api_service.utils.scan_contracts import (
    SERVICE_VS,
    STATE_COMPLETED,
    reporting_queue,
)
from backend.api_service.utils.reporting import AsyncSessionLocal, consume_messages, logger

_buffers: dict[str, list[dict[str, Any]]] = {}


def _buffer_stage(payload: dict[str, Any]) -> None:
    task_id = payload.get("task_id")
    if not task_id:
        return
    buf = _buffers.setdefault(task_id, [])
    for f in payload.get("findings") or []:
        data = f.get("data")
        if isinstance(data, dict):
            buf.append(data)  # data already carries the report.vs finding shape


async def _finalize(payload: dict[str, Any]) -> None:
    task_id = payload.get("task_id")
    org_id = payload.get("org_id")
    status = payload.get("status") or STATE_COMPLETED
    findings = _buffers.pop(task_id, []) if task_id else []

    asset_ids = {f.get("asset_id") for f in findings if f.get("asset_id")}
    targets = [{"asset_id": a, "host": "", "status": "scanned"} for a in asset_ids]

    ingest_payload = {
        "scan_run_id": task_id,
        "scan_id": (payload.get("config") or {}).get("scan_id"),
        "org_id": org_id,
        "status": "completed" if status == STATE_COMPLETED else "failed",
        "error": None if status == STATE_COMPLETED else status,
        "engine_versions": {},
        "targets": targets,
        "findings": findings,
    }
    try:
        from backend.reporting.vs.ingest import ingest_vs_result
        async with AsyncSessionLocal() as db:
            await ingest_vs_result(db, ingest_payload)  # persists + notifies
    except Exception:  # noqa: BLE001
        logger.exception("VS ingest failed for task=%s", task_id)


async def _handle(payload: dict[str, Any]) -> None:
    try:
        kind = payload.get("kind")
        if kind == "stage_findings":
            _buffer_stage(payload)
        elif kind == "task_terminal":
            await _finalize(payload)
        else:
            logger.info("vs reporting: unhandled kind=%s", kind)
    except Exception:  # noqa: BLE001
        logger.exception("vs reporting: failed to handle message")


async def run() -> None:
    q = reporting_queue(SERVICE_VS)
    logger.info("VS reporting consumer started -> %s", q)
    await consume_messages(q, _handle)

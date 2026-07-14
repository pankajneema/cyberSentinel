"""ASM reporting consumer — persists stage findings and finalizes the run.

Consumes ``reporting.asm`` (published by the Go worker). Message kinds:
  * stage_findings — upsert subdomain/ip/http findings into their tables.
  * task_terminal  — set asm_discoveries.status + last_run_at, notify, refresh CA.

For ASM the job's task_id IS the asm_discoveries.id, so finding rows use
asm_discovery_id = task_id.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.api_service.models.asm_models import (
    AsmAPIEndpoint,
    AsmDiscovery,
    AsmIP,
    AsmSubdomain,
)
from backend.api_service.utils.scan_contracts import (
    SERVICE_ASM,
    STATE_CANCELLED,
    STATE_COMPLETED,
    STATE_FAILED,
    reporting_queue,
)
from backend.api_service.utils.reporting import (
    AsyncSessionLocal,
    consume_messages,
    logger,
    notify_scan,
)

# Worker task states -> the asm_status enum (CANCELLED maps to FAILED for the rollup).
_STATUS = {STATE_COMPLETED: "COMPLETED", STATE_FAILED: "FAILED", STATE_CANCELLED: "FAILED"}


async def _upsert(db, model, values: dict, constraint: str) -> None:
    stmt = pg_insert(model.__table__).values(**values).on_conflict_do_nothing(constraint=constraint)
    await db.execute(stmt)


async def _persist_stage(payload: dict[str, Any]) -> None:
    discovery_id = payload.get("task_id")
    if not discovery_id:
        return
    asset_id = payload.get("asset_id") or ""
    org_id = payload.get("org_id")
    findings = payload.get("findings") or []
    if not findings:
        return
    async with AsyncSessionLocal() as db:
        for f in findings:
            ftype = f.get("type")
            target = (f.get("target") or "").strip()
            data = f.get("data") or {}
            if not target:
                continue
            try:
                if ftype == "subdomain":
                    await _upsert(db, AsmSubdomain, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "subdomain": target,
                    }, "uq_subdomain_per_asset")
                elif ftype == "resolution":
                    await _upsert(db, AsmSubdomain, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "subdomain": target, "resolved": True,
                    }, "uq_subdomain_per_asset")
                    for ip in (data.get("ips") or []):
                        if ip:
                            await _upsert(db, AsmIP, {
                                "asm_discovery_id": discovery_id, "org_id": org_id,
                                "asset_id": asset_id, "ip_address": ip, "subdomain": target,
                            }, "uq_ip_per_asset_subdomain")
                elif ftype == "ip":
                    await _upsert(db, AsmIP, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "ip_address": target,
                        "subdomain": data.get("subdomain"),
                    }, "uq_ip_per_asset_subdomain")
                elif ftype == "http":
                    await _upsert(db, AsmAPIEndpoint, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "url": target,
                        "status_code": data.get("status_code"),
                        "title": f.get("name") or None,
                    }, "uq_endpoint_per_discovery")
                else:
                    logger.debug("asm finding type %r not persisted (target=%s)", ftype, target)
            except Exception:  # noqa: BLE001 - one bad finding must not sink the batch
                logger.exception("persist asm finding type=%s target=%s", ftype, target)
        await db.commit()


async def _finalize(payload: dict[str, Any]) -> None:
    discovery_id = payload.get("task_id")
    org_id = payload.get("org_id")
    status = payload.get("status") or STATE_COMPLETED

    if discovery_id:
        async with AsyncSessionLocal() as db:
            disc = await db.get(AsmDiscovery, discovery_id)
            if disc is not None:
                disc.status = _STATUS.get(status, disc.status)
                disc.last_run_at = datetime.utcnow()
                await db.commit()

    await notify_scan(org_id, service=SERVICE_ASM, task_id=discovery_id, status=status)

    # Continuous-compliance refresh (best-effort; never blocks reporting).
    try:
        from backend.reporting.ca.ca_hook import trigger_ca_evaluation
        await trigger_ca_evaluation(org_id, reason="asm_scan")
    except Exception:  # noqa: BLE001
        logger.debug("CA refresh after ASM skipped", exc_info=True)


async def _handle(payload: dict[str, Any]) -> None:
    try:
        kind = payload.get("kind")
        if kind == "stage_findings":
            await _persist_stage(payload)
        elif kind == "task_terminal":
            await _finalize(payload)
        else:
            logger.info("asm reporting: unhandled kind=%s", kind)
    except Exception:  # noqa: BLE001 - ack (don't poison-DLQ) on a bad message
        logger.exception("asm reporting: failed to handle message")


async def run() -> None:
    q = reporting_queue(SERVICE_ASM)
    logger.info("ASM reporting consumer started -> %s", q)
    await consume_messages(q, _handle)

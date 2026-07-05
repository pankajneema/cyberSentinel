"""report.vs consumer — receives normalized VS scan results from the Go worker
and persists them via ingest_vs_result. Runs alongside the ASM consumer."""
from __future__ import annotations

import logging
from typing import Any

from backend.api_service.utils.database import AsyncSessionLocal
from backend.api_service.utils.queue import consume_messages
from backend.reporting.vs.ingest import ingest_vs_result

logger = logging.getLogger("cybersentinel.reporting.vs.consumer")


async def run_vs_consumer() -> None:
    async def callback(payload: dict[str, Any]) -> None:
        try:
            async with AsyncSessionLocal() as db:
                await ingest_vs_result(db, payload)
        except Exception as e:  # noqa: BLE001
            logger.error("report.vs processing failed: %s", e, exc_info=True)
            # Guarantee a terminal state so the run isn't stuck non-terminal
            # (ingest's own session already rolled back its partial writes).
            run_id = (payload or {}).get("scan_run_id")
            if run_id:
                try:
                    from sqlalchemy import update
                    from backend.api_service.models.vs_models import VsScanRun
                    async with AsyncSessionLocal() as db2:
                        await db2.execute(update(VsScanRun).where(VsScanRun.id == run_id)
                                          .values(status="FAILED", error_message=str(e)[:500]))
                        await db2.commit()
                except Exception:  # noqa: BLE001
                    pass
            # Do NOT re-raise: the run is now terminal (FAILED); acking avoids a
            # poison message with no auto-retry sitting in the DLQ.
    logger.info("VS reporting consumer listening on report.vs")
    await consume_messages("report.vs", callback)

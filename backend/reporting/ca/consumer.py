"""CA reporting consumer — runs the compliance engine on a scan terminal.

Consumes ``reporting.ca``. CA has no scan findings to persist; on the terminal it
invokes the Python CA engine (evaluate_org_isolated, via reporting/ca_hook.py)
over the org's evidence in Postgres.
"""

from __future__ import annotations

from typing import Any

from backend.api_service.utils.scan_contracts import SERVICE_CA, reporting_queue
from backend.api_service.utils.reporting import consume_messages, logger


async def _finalize(payload: dict[str, Any]) -> None:
    org_id = payload.get("org_id")
    try:
        from backend.reporting.ca.ca_hook import trigger_ca_evaluation
        await trigger_ca_evaluation(org_id, reason="ca_scan")
    except Exception:  # noqa: BLE001
        logger.exception("CA evaluation failed for org=%s", org_id)


async def _handle(payload: dict[str, Any]) -> None:
    try:
        kind = payload.get("kind")
        if kind == "task_terminal":
            await _finalize(payload)
        elif kind == "stage_findings":
            logger.debug("ca reporting: stage_findings marker (no-op)")
        else:
            logger.info("ca reporting: unhandled kind=%s", kind)
    except Exception:  # noqa: BLE001
        logger.exception("ca reporting: failed to handle message")


async def run() -> None:
    q = reporting_queue(SERVICE_CA)
    logger.info("CA reporting consumer started -> %s", q)
    await consume_messages(q, _handle)

"""Cross-language scan-execution contracts (Phase 0).

This is the Python mirror of the Go worker's `worker/core/contract.go`. Queue
names, the job-message shape, task states, and the Redis key schema MUST stay
byte-identical across both sides — change them here and in contract.go together,
or the publisher (Python) and consumer (Go) will disagree.

Importable both as `utils.scan_contracts` (api_service) and
`backend.api_service.utils.scan_contracts` (reporting).
"""

from __future__ import annotations

from typing import Any, Optional

# ---- services (also the job-message "type" discriminator) ----
SERVICE_ASM = "asm"
SERVICE_VS = "vs"
SERVICE_CA = "ca"
SERVICES: tuple[str, ...] = (SERVICE_ASM, SERVICE_VS, SERVICE_CA)

# ---- priorities → the ".high/.medium/.low" queue suffix ----
PRIORITY_HIGH = "high"
PRIORITY_MEDIUM = "medium"
PRIORITY_LOW = "low"
PRIORITIES: tuple[str, ...] = (PRIORITY_HIGH, PRIORITY_MEDIUM, PRIORITY_LOW)

# ---- per-service reporting queues (worker → reporting consumers) ----
def reporting_queue(service: str) -> str:
    """The queue a service's findings/terminal are published to (reporting.<service>)."""
    return f"reporting.{service}"


# Every reporting queue (one per service) — used by the reporting consumers.
REPORTING_QUEUES: list[str] = [reporting_queue(s) for s in SERVICES]

# ---- task lifecycle states (Postgres + Redis agree) ----
STATE_PENDING = "PENDING"
STATE_ADMITTED = "ADMITTED"
STATE_RUNNING = "RUNNING"
STATE_COMPLETED = "COMPLETED"
STATE_FAILED = "FAILED"
STATE_CANCELLED = "CANCELLED"
TASK_STATES: tuple[str, ...] = (
    STATE_PENDING,
    STATE_ADMITTED,
    STATE_RUNNING,
    STATE_COMPLETED,
    STATE_FAILED,
    STATE_CANCELLED,
)

# ---- scan modes / intensities ----
MODE_LIGHT = "LIGHT"
MODE_NORMAL = "NORMAL"
MODE_DEEP = "DEEP"


def queues_for(service: str) -> list[str]:
    """The three per-priority job queues for a service (asm.high/medium/low)."""
    return [f"{service}.{p}" for p in PRIORITIES]


def job_queue(service: str, priority: str) -> str:
    """Resolve the exact queue a job should be published to."""
    if priority not in PRIORITIES:
        priority = PRIORITY_MEDIUM
    return f"{service}.{priority}"


# Every job queue the worker consumes — used by infra/declaration and tests.
ALL_JOB_QUEUES: list[str] = [q for s in SERVICES for q in queues_for(s)]


# ---- Redis key schema (must match contract.go) ----
def slots_key(service: str) -> str:
    return f"slots:{service}"


def task_key(task_id: str) -> str:
    return f"task:{task_id}"


def cancel_key(task_id: str) -> str:
    return f"task:{task_id}:cancel"


def lease_key(task_id: str) -> str:
    return f"task:{task_id}:lease"


def events_channel(org_id: str) -> str:
    return f"task_events:{org_id}"


def build_job_message(
    *,
    type: str,
    priority: str,
    task_id: str,
    org_id: str,
    asset_id: Optional[str] = None,
    targets: Optional[list[str]] = None,
    mode: str = MODE_NORMAL,
    config: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build the unified job message the worker consumes.

    Shape (locked): {type, priority, task_id, org_id, asset_id, targets, mode, config}.
    """
    return {
        "type": type,
        "priority": priority,
        "task_id": task_id,
        "org_id": org_id,
        "asset_id": asset_id,
        "targets": list(targets or []),
        "mode": mode,
        "config": dict(config or {}),
    }

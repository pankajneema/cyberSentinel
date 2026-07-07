"""CA evaluation hook for the reporting consumers.

The reporting service imports api_service modules under the prefixed spelling
(`backend.api_service.models.vs_models`), while those modules internally use
bare imports (`from utils.database import Base`) — so the bare `utils`/`config`
modules are already loaded, and all tables live on ONE shared Base. If the CA
engine were imported naively, its bare `models.*` imports would create SECOND
module objects that re-register the same tables on that shared Base →
`InvalidRequestError: Table already defined` (found in the CA audit; the old
inline hook died silently on first fire).

Fix: before importing the engine, alias every loaded `backend.api_service.X`
module to its bare name `X` in sys.modules, so bare imports resolve to the
already-loaded module objects instead of re-executing them.
"""

from __future__ import annotations

import logging
import sys

logger = logging.getLogger("reporting.ca_hook")

_PREFIX = "backend.api_service."
_wired = False


def _alias_api_service_modules() -> None:
    global _wired
    if _wired:
        return
    for name, module in list(sys.modules.items()):
        if name.startswith(_PREFIX):
            sys.modules.setdefault(name[len(_PREFIX):], module)
    _wired = True


async def trigger_ca_evaluation(org_id: str | None, reason: str) -> None:
    """Best-effort continuous-compliance refresh. Never raises — but failures
    are logged at ERROR (not warning) so a dead hook is visible in monitoring."""
    if not org_id:
        return
    try:
        _alias_api_service_modules()
        from backend.api_service.ca.engine import evaluate_org_isolated
        await evaluate_org_isolated(org_id, reason=reason)
    except Exception:  # noqa: BLE001
        logger.exception("CA evaluation hook FAILED (org=%s, reason=%s) — "
                         "real-time compliance sync is degraded to the scheduler tick", org_id, reason)

"""Shared ASM asset-processor helpers.

Home for logic every asset-type processor (domain/ip/cloud/saas/repo/user)
previously copy-pasted. Keep this module free of asset-type specifics.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api_service.models.asm_models import AsmDiscoveryRun


async def ensure_discovery_run(
    db: AsyncSession,
    job_id: str,
    user_id: str,
    *,
    strict_single: bool = False,
) -> AsmDiscoveryRun:
    """Find the latest AsmDiscoveryRun for a discovery or create one.

    Preserves the historical per-site semantics exactly:
      - existing run: backfill started_at, force status to RUNNING;
      - new run: triggered_by='API', run_mode='QUICK' (hardcoded contract —
        do NOT change), status='RUNNING', flushed so run.id is available.

    ``strict_single`` mirrors domain.py's original ``scalar_one_or_none()``
    (raises if multiple runs exist); the other asset processors historically
    used ``.scalars().first()``.
    """
    result = await db.execute(
        select(AsmDiscoveryRun)
        .where(AsmDiscoveryRun.asm_discovery_id == job_id)
        .order_by(AsmDiscoveryRun.created_at.desc())
    )
    run = result.scalar_one_or_none() if strict_single else result.scalars().first()

    if run:
        if not run.started_at:
            run.started_at = datetime.utcnow()
        run.status = "RUNNING"
    else:
        run = AsmDiscoveryRun(
            asm_discovery_id=job_id,
            user_id=user_id,
            triggered_by="API",
            run_mode="QUICK",
            status="RUNNING",
            started_at=datetime.utcnow(),
        )
        db.add(run)
        await db.flush()  # flush to get run.id
    return run

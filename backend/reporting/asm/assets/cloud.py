"""Cloud asset-type ASM reporting.

Mirrors process_ip_asm: ensures a discovery-run record exists, persists each
COMPLETED pipeline step via the shared store_step_data (which routes the cloud
stages — public_endpoint_detect / config_review_readonly / full_osint_correlation
— to store_cloud_resources), then marks the run COMPLETED.

Before this, cloud discoveries hit "Unsupported asset type" in the consumer and
all results were dropped with no run record, leaving the discovery stuck.
"""
import logging
from typing import Any
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api_service.models.asm_models import AsmDiscoveryRun
from backend.reporting.asm.assets.domain import get_user_id_from_discovery, store_step_data

logger = logging.getLogger(__name__)


async def process_cloud_asm(db: AsyncSession, payload: dict[str, Any]) -> None:
    job_id = payload.get("job_id")
    intensity = payload.get("intensity", "LIGHT")
    status = payload.get("status", "COMPLETED")
    user_id = await get_user_id_from_discovery(db, job_id) or "system"

    run = (
        (
            await db.execute(
                select(AsmDiscoveryRun)
                .where(AsmDiscoveryRun.asm_discovery_id == job_id)
                .order_by(AsmDiscoveryRun.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if not run:
        run = AsmDiscoveryRun(
            asm_discovery_id=job_id,
            user_id=user_id,
            triggered_by="API",
            run_mode="QUICK",
            status="RUNNING",
            started_at=datetime.utcnow(),
        )
        db.add(run)
        await db.flush()
    else:
        run.status = "RUNNING"
        if not run.started_at:
            run.started_at = datetime.utcnow()

    cloud_inserted = 0
    for step in payload.get("pipeline", []):
        if step.get("status") != "COMPLETED":
            continue
        step_name = step.get("step", "")
        step_asset_id = step.get("asset_id") or payload.get("asset_id")
        if not step_asset_id:
            continue
        try:
            async with db.begin_nested():  # isolate each step (one bad row != whole job)
                counts = await store_step_data(
                    db=db,
                    job_id=job_id,
                    step_name=step_name,
                    result=step.get("result", {}) or {},
                    asset_id=step_asset_id,
                )
            cloud_inserted += int(counts.get("cloud_resources", 0) or 0)
        except Exception as step_err:
            logger.warning(f"Cloud step '{step_name}' failed (isolated, job continues): {step_err}")

    run.status = status
    run.completed_at = datetime.utcnow()
    run.summary = {
        "intensity": intensity,
        "cloud_resources": {"inserted": cloud_inserted},
        "pipeline_steps": len(payload.get("pipeline", [])),
    }
    await db.commit()
    logger.info("✅ Cloud ASM Completed job=%s cloud_resources=%d", job_id, cloud_inserted)

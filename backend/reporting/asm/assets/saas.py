"""SaaS asset-type ASM reporting.

Mirrors process_cloud_asm: ensures a discovery-run record exists, persists each
COMPLETED pipeline step (routing the saas_detect stage to store_saas_apps)
inside a per-step savepoint, then marks the run COMPLETED.
"""
import logging
from typing import Any
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api_service.models.asm_models import AsmDiscovery, AsmDiscoveryRun, AsmSaasApp
from backend.reporting.asm.assets.domain import get_user_id_from_discovery
from backend.reporting.sanitize import clean_str, clean_deep

logger = logging.getLogger(__name__)


async def store_saas_apps(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    org_id: str | None = None,
) -> int:
    """Extract and store SaaS applications from saas_detect step result."""
    inserted = 0
    apps_data = result.get("apps", [])
    if not isinstance(apps_data, list):
        return 0

    for item in apps_data:
        if not isinstance(item, dict):
            continue

        app_name = item.get("app_name", "")
        if not app_name:
            continue

        try:
            stmt = (
                insert(AsmSaasApp)
                .values(
                    asm_discovery_id=job_id,
                    org_id=org_id,
                    asset_id=asset_id,
                    app_name=str(app_name).strip(),
                    vendor=clean_str(item.get("vendor")),
                    category=clean_str(item.get("category")),
                    url=clean_str(item.get("url")),
                    status=clean_str(item.get("status")),
                    discovery_method=clean_str(item.get("discovery_method")),
                    extra_info=clean_deep(item),
                )
                .on_conflict_do_nothing(index_elements=["asm_discovery_id", "app_name"])
                .returning(AsmSaasApp.id)
            )
            res = await db.execute(stmt)
            if res.scalar_one_or_none():
                inserted += 1
        except Exception as e:
            logger.warning(f"Error inserting saas app {app_name}: {e}")

    return inserted


async def process_saas_asm(db: AsyncSession, payload: dict[str, Any]) -> None:
    job_id = payload.get("job_id")
    intensity = payload.get("intensity", "LIGHT")
    status = payload.get("status", "COMPLETED")
    user_id = await get_user_id_from_discovery(db, job_id) or "system"
    org_id = (
        await db.execute(select(AsmDiscovery.org_id).where(AsmDiscovery.id == job_id))
    ).scalar_one_or_none()

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

    apps_inserted = 0
    for step in payload.get("pipeline", []):
        if step.get("status") != "COMPLETED":
            continue
        step_name = step.get("step", "")
        if step_name != "saas_detect":
            continue
        step_asset_id = step.get("asset_id") or payload.get("asset_id")
        if not step_asset_id:
            continue
        try:
            async with db.begin_nested():  # isolate each step (one bad row != whole job)
                apps_inserted += await store_saas_apps(
                    db=db,
                    job_id=job_id,
                    result=step.get("result", {}) or {},
                    asset_id=step_asset_id,
                    org_id=org_id,
                )
        except Exception as step_err:
            logger.warning(f"SaaS step '{step_name}' failed (isolated, job continues): {step_err}")

    run.status = status
    run.completed_at = datetime.utcnow()
    run.summary = {
        "intensity": intensity,
        "saas_apps": {"inserted": apps_inserted},
        "pipeline_steps": len(payload.get("pipeline", [])),
    }
    await db.commit()
    logger.info("✅ SaaS ASM Completed job=%s saas_apps=%d", job_id, apps_inserted)

"""User asset-type ASM reporting.

Mirrors process_cloud_asm: ensures a discovery-run record exists, persists each
COMPLETED pipeline step (routing the email_leak_check stage to
store_user_accounts) inside a per-step savepoint, then marks the run COMPLETED.

The DEEP user pipeline also runs full_osint_correlation; that step is ignored
here (it has no user-account storage handler) and does not affect the run.
"""
import logging
from typing import Any
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api_service.models.asm_models import AsmDiscovery, AsmUserAccount
from backend.api_service.models.asset_models import Asset
from backend.reporting.asm.assets.common import ensure_discovery_run
from backend.reporting.asm.assets.domain import get_user_id_from_discovery
from backend.api_service.utils.sanitize import clean_str, clean_deep

logger = logging.getLogger(__name__)


async def store_user_accounts(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    org_id: str | None = None,
) -> int:
    """Extract and store exposed accounts from email_leak_check step result."""
    inserted = 0
    accounts_data = result.get("accounts", [])
    if not isinstance(accounts_data, list):
        return 0

    for item in accounts_data:
        if not isinstance(item, dict):
            continue

        email = item.get("email", "")
        if not email:
            continue

        breach_count = item.get("breach_count")
        try:
            breach_count = int(breach_count) if breach_count is not None else None
        except (TypeError, ValueError):
            breach_count = None

        exposed_data = item.get("exposed_data")
        if not isinstance(exposed_data, list):
            exposed_data = None

        try:
            stmt = (
                insert(AsmUserAccount)
                .values(
                    asm_discovery_id=job_id,
                    org_id=org_id,
                    asset_id=asset_id,
                    email=str(email).strip(),
                    source=item.get("source"),
                    breached=bool(item.get("breached", False)),
                    breach_count=breach_count,
                    exposed_data=clean_deep(exposed_data),
                    severity=clean_str(item.get("severity")),
                    extra_info=clean_deep(item),
                )
                .on_conflict_do_nothing(index_elements=["asm_discovery_id", "email", "source"])
                .returning(AsmUserAccount.id)
            )
            res = await db.execute(stmt)
            if res.scalar_one_or_none():
                inserted += 1
        except Exception as e:
            logger.warning("Error inserting user account %s: %s", email, e)

    return inserted


async def process_user_asm(db: AsyncSession, payload: dict[str, Any]) -> None:
    job_id = payload.get("job_id")
    intensity = payload.get("intensity", "LIGHT")
    status = payload.get("status", "COMPLETED")
    user_id = await get_user_id_from_discovery(db, job_id) or "system"
    org_id = (
        await db.execute(select(AsmDiscovery.org_id).where(AsmDiscovery.id == job_id))
    ).scalar_one_or_none()

    run = await ensure_discovery_run(db, job_id, user_id)

    accounts_inserted = 0
    touched_asset_ids: set[str] = set()
    for step in payload.get("pipeline", []):
        if step.get("status") != "COMPLETED":
            continue
        step_name = step.get("step", "")
        if step_name != "email_leak_check":
            continue
        step_asset_id = step.get("asset_id") or payload.get("asset_id")
        if not step_asset_id:
            continue
        touched_asset_ids.add(step_asset_id)
        try:
            async with db.begin_nested():  # isolate each step (one bad row != whole job)
                accounts_inserted += await store_user_accounts(
                    db=db,
                    job_id=job_id,
                    result=step.get("result", {}) or {},
                    asset_id=step_asset_id,
                    org_id=org_id,
                )
        except Exception as step_err:
            logger.warning("User step '%s' failed (isolated, job continues): %s", step_name, step_err)

    run.status = status
    run.completed_at = datetime.utcnow()

    # See domain.py's process_domain_asm for why this is here: Asset.last_seen
    # had no writer anywhere in the codebase.
    if status == "COMPLETED" and touched_asset_ids:
        await db.execute(
            update(Asset).where(Asset.id.in_(touched_asset_ids)).values(last_seen=run.completed_at.isoformat() + "Z")
        )

    run.summary = {
        "intensity": intensity,
        "user_accounts": {"inserted": accounts_inserted},
        "pipeline_steps": len(payload.get("pipeline", [])),
    }
    await db.commit()
    logger.info("User ASM Completed job=%s user_accounts=%d", job_id, accounts_inserted)

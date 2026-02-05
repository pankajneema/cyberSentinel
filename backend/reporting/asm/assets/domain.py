"""
Domain ASM Reporting - Process discovered subdomains from pipeline results
"""

import logging
from typing import Any
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from backend.api_service.models.asm_models import AsmDiscoveryRun, AsmSubdomain

logger = logging.getLogger(__name__)


# -------------------------
# Utils
# -------------------------

def extract_subdomains(payload: dict[str, Any]) -> list[str]:
    subdomains = []
    pipeline = payload.get("pipeline", [])

    for step in pipeline:
        if step.get("status") == "COMPLETED":
            data = step.get("result", {}).get("data")
            if data:
                subdomains.extend(data)

    return subdomains


# -------------------------
# Main Processor
# -------------------------

async def process_domain_asm(db: AsyncSession, payload: dict[str, Any]) -> None:

    job_id = payload.get("job_id")
    asset_id = payload.get("asset_id")
    intensity = payload.get("intensity")

    logger.info(f"Processing ASM job={job_id}")

    subdomains = extract_subdomains(payload)
    run = None

    try:
        # -------------------------
        # Create Run
        # -------------------------

        run = AsmDiscoveryRun(
            asm_discovery_id=job_id,
            user_id="system",
            triggered_by="API",
            run_mode="QUICK",
            status="RUNNING"
        )

        db.add(run)
        await db.commit()
        await db.refresh(run)

        # -------------------------
        # Insert Subdomains
        # -------------------------

        inserted = 0

        for item in subdomains:
            subdomain = (
                item.get("subdomain") if isinstance(item, dict)
                else str(item)
            )

            if not subdomain:
                continue

            obj = AsmSubdomain(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                subdomain=subdomain
            )

            db.add(obj)
            inserted += 1

        await db.commit()

        # -------------------------
        # Complete Run
        # -------------------------

        run.status = "COMPLETED"
        run.completed_at = datetime.utcnow()
        run.summary = {
            "found": len(subdomains),
            "inserted": inserted,
            "skipped": len(subdomains) - inserted,
            "intensity": intensity
        }

        await db.commit()

        logger.info(f"✅ ASM Completed job={job_id}")

    except Exception as e:
        logger.error(f"ASM Failed job={job_id} error={e}", exc_info=True)

        if run:
            run.status = "FAILED"
            run.error_message = str(e)
            await db.commit()

        raise
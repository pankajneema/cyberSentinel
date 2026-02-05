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

def extract_subdomains(payload: dict[str, Any]) -> list[tuple[str, str]]:
    """Return list of (asset_id, subdomain) pairs extracted from completed steps."""
    entries: list[tuple[str, str]] = []
    pipeline = payload.get("pipeline", [])

    for step in pipeline:
        if step.get("status") != "COMPLETED":
            continue

        asset_id = step.get("asset_id") or payload.get("asset_id")
        data = step.get("result", {}).get("data")
        if not data:
            continue

        for item in data:
            subdomain = (item.get("subdomain") if isinstance(item, dict) else str(item))
            if not subdomain:
                continue
            entries.append((asset_id, subdomain))

    return entries


# -------------------------
# Main Processor
# -------------------------

async def process_domain_asm(db: AsyncSession, payload: dict[str, Any]) -> None:

    job_id = payload.get("job_id")
    asset_id = payload.get("asset_id")
    intensity = payload.get("intensity")

    logger.info(f"Processing ASM job={job_id}")

    subdomain_entries = extract_subdomains(payload)
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

        for asset_id, subdomain in subdomain_entries:
            if not asset_id:
                logger.warning(f"Skipping subdomain insert for job={job_id} missing asset_id subdomain={subdomain}")
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
            "found": len(subdomain_entries),
            "inserted": inserted,
            "skipped": len(subdomain_entries) - inserted,
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
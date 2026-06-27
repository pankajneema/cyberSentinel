"""Repository asset-type ASM reporting.

Mirrors process_cloud_asm: ensures a discovery-run record exists, persists each
COMPLETED pipeline step (routing the repo_secret_scan stage to
store_repo_findings) inside a per-step savepoint, then marks the run COMPLETED.

The DEEP repo pipeline also runs full_osint_correlation; that step is ignored
here (it has no repo-finding storage handler) and does not affect the run.
"""
import logging
from typing import Any
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api_service.models.asm_models import AsmDiscovery, AsmDiscoveryRun, AsmRepoFinding
from backend.reporting.asm.assets.domain import get_user_id_from_discovery

logger = logging.getLogger(__name__)


async def store_repo_findings(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    org_id: str | None = None,
) -> int:
    """Extract and store secret-scan findings from repo_secret_scan step result."""
    inserted = 0
    findings_data = result.get("findings", [])
    if not isinstance(findings_data, list):
        return 0

    for item in findings_data:
        if not isinstance(item, dict):
            continue

        repo_url = item.get("repo_url", "")
        if not repo_url:
            continue

        line = item.get("line")
        try:
            line = int(line) if line is not None else None
        except (TypeError, ValueError):
            line = None

        try:
            stmt = (
                insert(AsmRepoFinding)
                .values(
                    asm_discovery_id=job_id,
                    org_id=org_id,
                    asset_id=asset_id,
                    repo_url=str(repo_url).strip(),
                    finding_type=item.get("finding_type"),
                    rule=item.get("rule"),
                    severity=item.get("severity"),
                    file_path=item.get("file_path"),
                    line=line,
                    secret=item.get("secret"),
                    commit=item.get("commit"),
                    extra_info=item,
                )
                .on_conflict_do_nothing(
                    index_elements=["asm_discovery_id", "repo_url", "rule", "file_path", "line"]
                )
                .returning(AsmRepoFinding.id)
            )
            res = await db.execute(stmt)
            if res.scalar_one_or_none():
                inserted += 1
        except Exception as e:
            logger.warning(f"Error inserting repo finding {repo_url}: {e}")

    return inserted


async def process_repo_asm(db: AsyncSession, payload: dict[str, Any]) -> None:
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

    findings_inserted = 0
    for step in payload.get("pipeline", []):
        if step.get("status") != "COMPLETED":
            continue
        step_name = step.get("step", "")
        if step_name != "repo_secret_scan":
            continue
        step_asset_id = step.get("asset_id") or payload.get("asset_id")
        if not step_asset_id:
            continue
        try:
            async with db.begin_nested():  # isolate each step (one bad row != whole job)
                findings_inserted += await store_repo_findings(
                    db=db,
                    job_id=job_id,
                    result=step.get("result", {}) or {},
                    asset_id=step_asset_id,
                    org_id=org_id,
                )
        except Exception as step_err:
            logger.warning(f"Repo step '{step_name}' failed (isolated, job continues): {step_err}")

    run.status = status
    run.completed_at = datetime.utcnow()
    run.summary = {
        "intensity": intensity,
        "repo_findings": {"inserted": findings_inserted},
        "pipeline_steps": len(payload.get("pipeline", [])),
    }
    await db.commit()
    logger.info("✅ Repo ASM Completed job=%s repo_findings=%d", job_id, findings_inserted)

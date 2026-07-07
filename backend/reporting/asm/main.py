"""ASM Reporting Consumer - Routes events from RabbitMQ to handlers

Handles three types of events:
1. StepEvent - Step completion events (emitted after each step)
2. FinalEvent - Final pipeline completion event (triggers scoring)
3. EnhancedPipeline - Complete pipeline state (for processing results)
"""

import asyncio
import logging
import json
from typing import Any

# Register ALL ORM models on the shared Base.metadata BEFORE any DB flush.
# The asset processors only import asm_models, which foreign-keys to tables
# defined elsewhere (e.g. asm_discovery_runs.org_id -> organizations.id in
# tenancy_models). Without importing those modules, SQLAlchemy cannot resolve
# the FK target at flush time and raises NoReferencedTableError. Importing the
# model modules here (for their side effect of registering tables) fixes that.
from backend.api_service.models import (  # noqa: F401
    tenancy_models,   # organizations, member_profiles, org_invites, audit_logs
    asm_models,       # asm_discoveries, asm_discovery_runs, subdomains, ips, ...
    asset_models,     # assets
)

from backend.reporting.asm.assets.domain import process_domain_asm, store_step_data
from backend.reporting.asm.assets.ip import process_ip_asm
from backend.reporting.asm.assets.cloud import process_cloud_asm
from backend.reporting.asm.assets.repo import process_repo_asm
from backend.reporting.asm.assets.saas import process_saas_asm
from backend.reporting.asm.assets.user import process_user_asm
from backend.api_service.utils.database import AsyncSessionLocal
from backend.api_service.utils.queue import consume_messages, close_queue
from backend.api_service.utils.redis_client import get_redis, close_redis

logger = logging.getLogger(__name__)

async def handle_step_event(event: dict[str, Any]) -> None:
    """Handle step completion event - store data incrementally as it arrives"""
    job_id = event.get("job_id")
    stage = event.get("stage")
    tool = event.get("tool")
    status = event.get("status")
    progress = event.get("progress", 0)
    asset_id = event.get("asset_id")
    
    logger.info(
        "Step event: job=%s stage=%s tool=%s status=%s progress=%s%% asset_id=%s",
        job_id, stage, tool, status, progress, asset_id,
    )
    
    # Only store data if step completed successfully
    if status != "COMPLETED":
        logger.debug("Skipping data storage for failed step: %s", stage)
        return
    
    # Get step result from Redis pipeline state
    try:
        redis_client = await get_redis()
        pipeline_data = await redis_client.get(f"asm:pipeline:{job_id}")
        if pipeline_data:
            if isinstance(pipeline_data, (bytes, bytearray)):
                pipeline_data = pipeline_data.decode()
            if isinstance(pipeline_data, str):
                pipeline_data = json.loads(pipeline_data)
            
            # Find the current step in pipeline
            pipeline = pipeline_data.get("pipeline", [])
            step_result = None
            for step in pipeline:
                if step.get("step") == stage and step.get("status") == "COMPLETED":
                    step_result = step.get("result", {})
                    break
            
            if step_result:
                # Debug: log the shape only — never the raw step result body.
                logger.debug(
                    "Step result for %s: keys=%s", stage,
                    list(step_result.keys()) if isinstance(step_result, dict) else "not a dict",
                )
                
                # Store data incrementally
                async with AsyncSessionLocal() as db:
                    try:
                        counts = await store_step_data(
                            db, job_id, stage, step_result, asset_id or pipeline_data.get("asset_id", "")
                        )
                        await db.commit()
                        logger.info(
                            "Stored step data: job=%s stage=%s counts=%s",
                            job_id, stage, counts,
                        )
                    except Exception as e:
                        await db.rollback()
                        logger.error("Failed to store step data for %s: %s", stage, e, exc_info=True)
            else:
                logger.warning("No result found for step %s in pipeline state. Available steps: %s", stage, [s.get('step') for s in pipeline])
        else:
            logger.debug("No pipeline state found for job %s", job_id)
    except Exception as e:
        logger.warning("Failed to process step event incrementally: %s", e, exc_info=True)
        # Don't fail the entire event processing if incremental storage fails

async def handle_final_event(event: dict[str, Any], redis_client=None) -> None:
    """Handle final pipeline completion event: persist the scan results.

    NOTE: exposure scoring is NOT performed here. Assets are scored
    asynchronously by the API service's scheduler tick (_auto_score_assets),
    which reads the persisted rows. This handler's job is durable persistence."""
    job_id = event.get("job_id")
    status = event.get("status")
    progress = event.get("progress", 100)
    
    logger.info("Final event received: job=%s status=%s progress=%s%%", job_id, status, progress)
    
    # Get complete pipeline state from Redis
    job_detail = await redis_client.get(f"asm:pipeline:{job_id}")
    if not job_detail:
        logger.warning("No pipeline state found in cache for final event job=%s", job_id)
        return
    
    # Parse pipeline state
    try:
        if isinstance(job_detail, (bytes, bytearray)):
            job_detail = job_detail.decode()
        if isinstance(job_detail, str):
            job_detail = json.loads(job_detail)
    except Exception as e:
        logger.error("Failed to parse pipeline state for job %s: %s", job_id, e, exc_info=True)
        return
    
    # Persist the complete pipeline (scoring runs later via the API scheduler tick)
    asset_type = job_detail.get("asset_type")
    if not asset_type:
        logger.error("Missing asset_type in pipeline state for job %s", job_id)
        return
    
    async with AsyncSessionLocal() as db:
        try:
            if asset_type == "domain":
                await process_domain_asm(db, job_detail)
                logger.info("Domain pipeline processing completed for job=%s", job_id)
            elif asset_type == "ip":
                await process_ip_asm(db, job_detail)
                logger.info("IP pipeline processing completed for job=%s", job_id)
            elif asset_type == "cloud":
                await process_cloud_asm(db, job_detail)
                logger.info("Cloud pipeline processing completed for job=%s", job_id)
            elif asset_type == "repo":
                await process_repo_asm(db, job_detail)
                logger.info("Repo pipeline processing completed for job=%s", job_id)
            elif asset_type == "saas":
                await process_saas_asm(db, job_detail)
                logger.info("SaaS pipeline processing completed for job=%s", job_id)
            elif asset_type == "user":
                await process_user_asm(db, job_detail)
                logger.info("User pipeline processing completed for job=%s", job_id)
            else:
                logger.warning("Unsupported asset type: %s for job=%s", asset_type, job_id)

            # Continuous compliance: refresh CA controls fed by ASM data as soon
            # as discovery results are persisted. Isolated session + best-effort —
            # a CA failure never affects ASM persistence.
            try:
                from sqlalchemy import select as _select
                from backend.api_service.models.asm_models import AsmDiscovery
                _org_id = (
                    await db.execute(_select(AsmDiscovery.org_id).where(AsmDiscovery.id == job_id))
                ).scalar_one_or_none()
            except Exception as e:  # noqa: BLE001
                logger.warning("CA hook org lookup failed: %s", e)
                _org_id = None
            if _org_id:
                from backend.reporting.ca_hook import trigger_ca_evaluation
                await trigger_ca_evaluation(_org_id, reason="asm_ingest")
        except Exception as e:
            logger.error("Failed to process pipeline for job %s: %s", job_id, e, exc_info=True)
            raise

async def handle_pipeline_event(event: dict[str, Any]) -> None:
    """Handle complete pipeline state event - process results"""
    job_id = event.get("job_id")
    asset_type = event.get("asset_type")
    status = event.get("status")
    
    logger.info("Pipeline event: job=%s asset_type=%s status=%s", job_id, asset_type, status)
    
    # Only process if pipeline is COMPLETED or FAILED
    # Step events are handled separately, final event triggers full processing
    if status not in ["COMPLETED", "FAILED"]:
        logger.debug("Skipping pipeline event for job=%s - status=%s (not final)", job_id, status)
        return
    
    async with AsyncSessionLocal() as db:
        try:
            if asset_type == "domain":
                await process_domain_asm(db, event)
            elif asset_type == "ip":
                await process_ip_asm(db, event)
            elif asset_type == "cloud":
                await process_cloud_asm(db, event)
            elif asset_type == "repo":
                await process_repo_asm(db, event)
            elif asset_type == "saas":
                await process_saas_asm(db, event)
            elif asset_type == "user":
                await process_user_asm(db, event)
            else:
                logger.warning("Unsupported asset type: %s for job=%s", asset_type, job_id)
        except Exception as e:
            logger.error("Failed to process pipeline event for job %s: %s", job_id, e, exc_info=True)
            raise

async def handle_event(event: dict[str, Any], redis_client=None) -> None:
    """Route events to appropriate handler based on event type"""
    job_id = event.get("job_id")
    
    # Determine event type based on structure
    is_final = event.get("is_final", False)
    
    if is_final:
        # FinalEvent - triggers scoring
        if event.get("status") == "PIPELINE_COMPLETED":
            await handle_final_event(event, redis_client)
        else:
            # Log the shape only — never the raw message body.
            logger.warning("Unknown final event type: job=%s keys=%s", job_id, list(event.keys()))
    elif "stage" in event and "tool" in event:
        # StepEvent - step completion event
        await handle_step_event(event)
    elif "pipeline" in event and "asset_type" in event:
        # EnhancedPipeline - complete pipeline state
        await handle_pipeline_event(event)
    else:
        logger.warning("Unknown event type for job=%s: %s", job_id, list(event.keys()))

async def consume_events(redis_client) -> None:
    """Consume events from RabbitMQ queue and process them"""
    async def event_callback(payload: dict[str, Any]) -> None:
        """Callback for each message from queue"""
        try:
            logger.info("Received event: %s", payload.get('job_id'))
            await handle_event(payload, redis_client=redis_client)
            logger.info("Event processed: %s", payload.get('job_id'))
        except Exception as e:
            logger.error("Failed: %s", e, exc_info=True)
            raise
    
    await consume_messages("report.asm", event_callback)

async def main() -> None:
    """Start ASM Reporting Consumer"""
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting ASM Reporting Consumer...")
    redis_client = await get_redis()
    try:
        # Run the ASM and VS reporting consumers concurrently on their own queues.
        from backend.reporting.vs.consumer import run_vs_consumer
        await asyncio.gather(consume_events(redis_client), run_vs_consumer())
    except KeyboardInterrupt:
        logger.info("Shutdown requested")
    except Exception as e:
        logger.error("Consumer error: %s", e, exc_info=True)
    finally:
        await close_queue()
        logger.info("Consumer stopped")


if __name__ == "__main__":
    asyncio.run(main())

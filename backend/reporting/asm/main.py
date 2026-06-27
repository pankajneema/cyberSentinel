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
        f"Step event: job={job_id} stage={stage} tool={tool} "
        f"status={status} progress={progress}% asset_id={asset_id}"
    )
    
    # Only store data if step completed successfully
    if status != "COMPLETED":
        logger.debug(f"Skipping data storage for failed step: {stage}")
        return
    
    # Get step result from Redis pipeline state
    try:
        redis_client = await get_redis()
        pipeline_data = await redis_client.get(f"asm:pipeline:{job_id}")
        if pipeline_data:
            if isinstance(pipeline_data, (bytes, bytearray)):
                pipeline_data = pipeline_data.decode()
            if isinstance(pipeline_data, str):
                import json
                pipeline_data = json.loads(pipeline_data)
            
            # Find the current step in pipeline
            pipeline = pipeline_data.get("pipeline", [])
            step_result = None
            for step in pipeline:
                if step.get("step") == stage and step.get("status") == "COMPLETED":
                    step_result = step.get("result", {})
                    break
            
            if step_result:
                # Debug: Log what we're trying to store
                logger.debug(f"Step result for {stage}: keys={list(step_result.keys()) if isinstance(step_result, dict) else 'not a dict'}, result={step_result}")
                
                # Store data incrementally
                async with AsyncSessionLocal() as db:
                    try:
                        counts = await store_step_data(
                            db, job_id, stage, step_result, asset_id or pipeline_data.get("asset_id", "")
                        )
                        await db.commit()
                        logger.info(
                            f"✅ Stored step data: job={job_id} stage={stage} "
                            f"counts={counts}"
                        )
                    except Exception as e:
                        await db.rollback()
                        logger.error(f"Failed to store step data for {stage}: {e}", exc_info=True)
            else:
                logger.warning(f"No result found for step {stage} in pipeline state. Available steps: {[s.get('step') for s in pipeline]}")
        else:
            logger.debug(f"No pipeline state found for job {job_id}")
    except Exception as e:
        logger.warning(f"Failed to process step event incrementally: {e}", exc_info=True)
        # Don't fail the entire event processing if incremental storage fails

async def handle_final_event(event: dict[str, Any], redis_client=None) -> None:
    """Handle final pipeline completion event - trigger scoring and processing"""
    job_id = event.get("job_id")
    status = event.get("status")
    progress = event.get("progress", 100)
    
    logger.info(f"Final event received: job={job_id} status={status} progress={progress}%")
    
    # Get complete pipeline state from Redis
    job_detail = await redis_client.get(f"asm:pipeline:{job_id}")
    if not job_detail:
        logger.warning(f"No pipeline state found in cache for final event job={job_id}")
        return
    
    # Parse pipeline state
    try:
        if isinstance(job_detail, (bytes, bytearray)):
            job_detail = job_detail.decode()
        if isinstance(job_detail, str):
            job_detail = json.loads(job_detail)
    except Exception as e:
        logger.error(f"Failed to parse pipeline state for job {job_id}: {e}", exc_info=True)
        return
    
    # Process the complete pipeline (this triggers scoring)
    asset_type = job_detail.get("asset_type")
    if not asset_type:
        logger.error(f"Missing asset_type in pipeline state for job {job_id}")
        return
    
    async with AsyncSessionLocal() as db:
        try:
            if asset_type == "domain":
                await process_domain_asm(db, job_detail)
                logger.info(f"✅ Domain pipeline processing completed for job={job_id}")
            elif asset_type == "ip":
                await process_ip_asm(db, job_detail)
                logger.info(f"✅ IP pipeline processing completed for job={job_id}")
            else:
                logger.warning(f"Unsupported asset type: {asset_type} for job={job_id}")
        except Exception as e:
            logger.error(f"Failed to process pipeline for job {job_id}: {e}", exc_info=True)
            raise

async def handle_pipeline_event(event: dict[str, Any]) -> None:
    """Handle complete pipeline state event - process results"""
    job_id = event.get("job_id")
    asset_type = event.get("asset_type")
    status = event.get("status")
    
    logger.info(f"Pipeline event: job={job_id} asset_type={asset_type} status={status}")
    
    # Only process if pipeline is COMPLETED or FAILED
    # Step events are handled separately, final event triggers full processing
    if status not in ["COMPLETED", "FAILED"]:
        logger.debug(f"Skipping pipeline event for job={job_id} - status={status} (not final)")
        return
    
    async with AsyncSessionLocal() as db:
        try:
            if asset_type == "domain":
                await process_domain_asm(db, event)
            elif asset_type == "ip":
                await process_ip_asm(db, event)
            else:
                logger.warning(f"Unsupported asset type: {asset_type} for job={job_id}")
        except Exception as e:
            logger.error(f"Failed to process pipeline event for job {job_id}: {e}", exc_info=True)
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
            logger.warning(f"Unknown final event type: {event}")
    elif "stage" in event and "tool" in event:
        # StepEvent - step completion event
        await handle_step_event(event)
    elif "pipeline" in event and "asset_type" in event:
        # EnhancedPipeline - complete pipeline state
        await handle_pipeline_event(event)
    else:
        logger.warning(f"Unknown event type for job={job_id}: {list(event.keys())}")         

async def consume_events(redis_client) -> None:
    """Consume events from RabbitMQ queue and process them"""
    async def event_callback(payload: dict[str, Any]) -> None:
        """Callback for each message from queue"""
        try:
            logger.info(f"Received event: {payload.get('job_id')}")
            await handle_event(payload, redis_client=redis_client)
            logger.info(f"✅ Event processed: {payload.get('job_id')}")
        except Exception as e:
            logger.error(f"❌ Failed: {e}", exc_info=True)
            raise
    
    await consume_messages("report.asm", event_callback)

async def main() -> None:
    """Start ASM Reporting Consumer"""
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting ASM Reporting Consumer...")
    redis_client = await get_redis()
    try:
        await consume_events(redis_client)
    except KeyboardInterrupt:
        logger.info("Shutdown requested")
    except Exception as e:
        logger.error(f"Consumer error: {e}", exc_info=True)
    finally:
        await close_queue()
        logger.info("Consumer stopped")


if __name__ == "__main__":
    asyncio.run(main())

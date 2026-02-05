"""ASM Reporting Consumer - Routes events from RabbitMQ to handlers"""

import asyncio
import logging
import json
from typing import Any
from backend.reporting.asm.assets.domain import process_domain_asm
from backend.api_service.utils.database import AsyncSessionLocal
from backend.api_service.utils.queue import consume_messages, close_queue
from backend.api_service.utils.redis_client import get_redis, close_redis

logger = logging.getLogger(__name__)

async def handle_event(event: dict[str, Any], redis_client=None) -> None:
    """Process event and route to appropriate handler"""
    asset_type = event.get("asset_type")
    logger.info(f"Processing event {event.get('job_id')} - asset_type={asset_type}")
    
    # Get Job detail from Redis cache (if needed for additional context)
    job_id = event.get("job_id")
    job_detail = await redis_client.get(f"asm:pipeline:{job_id}")
    if job_detail:
        # Redis client may return bytes or a JSON string; normalize to dict
        try:
            if isinstance(job_detail, (bytes, bytearray)):
                job_detail = job_detail.decode()
            if isinstance(job_detail, str):
                job_detail = json.loads(job_detail)
        except Exception as e:
            logger.error(f"Failed to parse job detail from cache for job {job_id}: {e}", exc_info=True)
            job_detail = None

    if job_detail:
        logger.info(f"Retrieved job detail from cache for job {job_id}")

        async with AsyncSessionLocal() as db:
            try:
                if asset_type == "domain":
                    await process_domain_asm(db, job_detail)
                else:
                    raise ValueError(f"Unsupported asset type: {asset_type}")
            except Exception as e:
                logger.error(f"Failed to process event: {e}", exc_info=True)
                raise
    else:     
        logger.warning(f"No job detail found in cache for job {job_id}")         

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

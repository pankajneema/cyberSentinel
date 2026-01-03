"""
RabbitMQ / Message Queue Connection (ASYNC)
"""

import json
import logging
import aio_pika
from config.settings import settings

logger = logging.getLogger(__name__)

# Async connection (singleton)
_queue_connection: aio_pika.RobustConnection | None = None


async def get_queue_connection() -> aio_pika.RobustConnection | None:
    """
    Get RabbitMQ async connection (singleton)
    """
    global _queue_connection

    if _queue_connection and not _queue_connection.is_closed:
        return _queue_connection

    try:
        _queue_connection = await aio_pika.connect_robust(
            host=settings.RABBITMQ_HOST,
            port=settings.RABBITMQ_PORT,
            login=settings.RABBITMQ_USER,
            password=settings.RABBITMQ_PASSWORD,
        )
        logger.info("RabbitMQ async connected successfully")
        return _queue_connection

    except Exception as e:
        logger.error(f"RabbitMQ async connection failed: {e}")
        return None



async def publish_message(queue_name: str, message: dict) -> bool:
    """
    Publish message to queue (ASYNC)
    """
    try:
        connection = await get_queue_connection()
        if not connection:
            logger.warning("Queue not available, message not sent")
            return False

        channel = await connection.channel()

        await channel.declare_queue(
            queue_name,
            durable=True
        )

        await channel.default_exchange.publish(
            aio_pika.Message(
                body=json.dumps(message).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ),
            routing_key=queue_name
        )

        logger.info(f"Message published to {queue_name}")
        return True

    except Exception as e:
        logger.exception("Failed to publish message")
        return False



async def consume_messages(queue_name: str, callback):
    """
    Consume messages from queue (ASYNC)

    callback signature:
        async def callback(payload: dict)
    """
    try:
        connection = await get_queue_connection()
        if not connection:
            logger.warning("Queue not available")
            return

        channel = await connection.channel()
        await channel.set_qos(prefetch_count=1)

        queue = await channel.declare_queue(
            queue_name,
            durable=True
        )

        logger.info(f"Consuming messages from {queue_name}")

        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                try:
                    payload = json.loads(message.body)

                    await callback(payload)

                    await message.ack()

                except Exception:
                    logger.exception("Message processing failed")
                    await message.nack(requeue=False)

    except Exception as e:
        logger.exception("Failed to consume messages")



async def close_queue():
    """
    Close RabbitMQ async connection
    """
    global _queue_connection

    if _queue_connection and not _queue_connection.is_closed:
        await _queue_connection.close()

    _queue_connection = None
    logger.info("Queue connection closed")

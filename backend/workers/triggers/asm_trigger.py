import asyncio
import httpx
from utils.queue import consume_messages
from config.settings import settings

QUEUE_NAME = "asm.triggers"


# ---------------------------------------------------
# Call ASM microservice
# ---------------------------------------------------
async def run_asm_task(payload: dict):
    try:
        url = f"{settings.ASM_MICROSERVICE}/discovery/start"

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()

            print("[ASM_RUNNER] ASM service triggered")
    except Exception as e:
        print("Error in Running Message  ::",e)        


# ---------------------------------------------------   
# Handle message (NO ACK/NACK HERE)
# ---------------------------------------------------
async def handle_message(payload: dict):
    print("[ASM_CONSUMER] Received:", payload)
    await run_asm_task(payload)


# ---------------------------------------------------
# Start consumer
# ---------------------------------------------------
async def start_asm_consumer():
    print("[ASM_CONSUMER] Starting consumer:", QUEUE_NAME)
    await consume_messages(QUEUE_NAME, handle_message)


if __name__ == "__main__":
    asyncio.run(start_asm_consumer())

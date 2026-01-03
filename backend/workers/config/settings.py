"""
Application Configuration
Loads from environment variables (.env)
"""

import os
from typing import Optional
from dotenv import load_dotenv, find_dotenv

# -------------------------------------------------------------------
# Load .env file EXPLICITLY
# -------------------------------------------------------------------
ENV_PATH = find_dotenv()
load_dotenv(ENV_PATH)

# -------------------------------------------------------------------
# Settings
# -------------------------------------------------------------------
class Settings:
    # -------------------- Database --------------------
    DATABASE_URL: Optional[str] = os.getenv("DATABASE_URL")

    # -------------------- Redis -----------------------
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_DB: int = int(os.getenv("REDIS_DB", "0"))

    # -------------------- RabbitMQ --------------------
    RABBITMQ_URL: str = os.getenv(
        "RABBITMQ_URL",
        "amqp://guest:guest@localhost:5672/"
    )
    RABBITMQ_HOST: str = os.getenv("RABBITMQ_HOST", "localhost")
    RABBITMQ_PORT: int = int(os.getenv("RABBITMQ_PORT", "5672"))
    RABBITMQ_USER: str = os.getenv("RABBITMQ_USER", "guest")
    RABBITMQ_PASSWORD: str = os.getenv("RABBITMQ_PASSWORD", "guest")
    
    #--------------- Micro-services Urls ---------------
    ASM_MICROSERVICE: str  = os.getenv("ASM_MICROSERVICE")
   
    APP_NAME: str = "CyberSentinel Worker Service"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"

# -------------------------------------------------------------------
# Instantiate settings
# -------------------------------------------------------------------
settings = Settings()

# -------------------------------------------------------------------
# Safety check (VERY IMPORTANT)
# -------------------------------------------------------------------
if not settings.DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Check your .env file loading."
    )

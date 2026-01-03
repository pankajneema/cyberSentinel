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

    # -------------------- JWT -------------------------
    SECRET_KEY: str = os.getenv(
        "SECRET_KEY",
        "your-secret-key-change-in-production"
    )
    JWT_SECRET: str = os.getenv(
        "JWT_SECRET",
        "your-jwt-secret-change-in-production"
    )
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
    )

    # -------------------- ClickHouse ------------------
    CLICKHOUSE_URL: str = os.getenv(
        "CLICKHOUSE_URL",
        "http://localhost:8123"
    )
    CLICKHOUSE_HOST: str = os.getenv("CLICKHOUSE_HOST", "localhost")
    CLICKHOUSE_PORT: int = int(os.getenv("CLICKHOUSE_PORT", "8123"))
    CLICKHOUSE_USER: str = os.getenv("CLICKHOUSE_USER", "default")
    CLICKHOUSE_PASSWORD: str = os.getenv("CLICKHOUSE_PASSWORD", "")

    # -------------------- App -------------------------
    APP_NAME: str = "CyberSentinel API Service"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"

    # -------------------- CORS ------------------------
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8000",
        "http://localhost:8081"
    ]


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

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

    # -------------------- JWT (legacy — being removed) -------------------------
    # Supabase now signs/verifies all tokens. These remain ONLY until the legacy
    # auth routes are deleted. No hardcoded fallbacks: empty unless explicitly set.
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")

    # Authorization-to-scan: when true, active discoveries (NORMAL/DEEP) require
    # the target asset(s) to have proven ownership. Set false only in dev.
    REQUIRE_SCAN_VERIFICATION: bool = os.getenv("REQUIRE_SCAN_VERIFICATION", "true").lower() == "true"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
    )

    # -------------------- Supabase (identity provider) --------------------
    # Supabase owns ALL authentication. The backend only validates its JWTs.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    # HS256 projects: set the project's JWT secret. Leave empty to use JWKS (RS256).
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")
    # Service-role key only for admin actions (invites, role changes). Never expose to client.
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    # Shared secret for the Supabase DB webhook (user.created/deleted provisioning).
    SUPABASE_WEBHOOK_SECRET: str = os.getenv("SUPABASE_WEBHOOK_SECRET", "")

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
    # Comma-separated allow-list. Never combine "*" with credentials.
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS_URL", "").split(",") if o.strip()
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

# Fail fast on misconfigured identity. Supabase must be configured (a JWT
# secret for HS256, or a URL for JWKS/RS256) or the API cannot authenticate.
if not settings.SUPABASE_URL:
    raise RuntimeError(
        "SUPABASE_URL is not set. Supabase is the identity provider; configure it in .env."
    )
if not settings.SUPABASE_JWT_SECRET and not settings.SUPABASE_URL:
    raise RuntimeError(
        "Set SUPABASE_JWT_SECRET (HS256) or rely on SUPABASE_URL JWKS (RS256)."
    )

# In production, never run with permissive CORS or empty origins.
if not settings.DEBUG and not settings.CORS_ORIGINS:
    raise RuntimeError(
        "CORS_ORIGINS_URL is empty. Set an explicit comma-separated allow-list in production."
    )



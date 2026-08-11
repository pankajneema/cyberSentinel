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

    # -------------------- JWT (self-issued) -------------------------
    # We are the identity provider: we sign and verify our own access/refresh
    # tokens. No hardcoded fallback for the secret — empty unless explicitly set.
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")

    # Authorization-to-scan: when true, active discoveries (NORMAL/DEEP) require
    # the target asset(s) to have proven ownership. Set false only in dev.
    REQUIRE_SCAN_VERIFICATION: bool = os.getenv("REQUIRE_SCAN_VERIFICATION", "true").lower() == "true"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
    )
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(
        os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30")
    )

    # -------------------- OAuth (Google / GitHub) --------------------
    # Optional: unset providers return a 503 from their /oauth/{provider} route
    # rather than failing app startup — OAuth is additive, not a hard requirement.
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GITHUB_CLIENT_ID: str = os.getenv("GITHUB_CLIENT_ID", "")
    GITHUB_CLIENT_SECRET: str = os.getenv("GITHUB_CLIENT_SECRET", "")
    # Base URL this API is reachable at, used to build OAuth callback URLs.
    OAUTH_REDIRECT_BASE_URL: str = os.getenv("OAUTH_REDIRECT_BASE_URL", "http://localhost:8000")
    # Frontend origin, used for post-auth redirects (OAuth callback, password reset links).
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:8080")

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

# Fail fast on misconfigured identity. We sign our own tokens, so a real
# secret is mandatory or the API cannot issue or verify sessions.
if not settings.JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET is not set. Required to sign/verify access tokens. "
        'Generate one: python -c "import secrets; print(secrets.token_urlsafe(48))"'
    )

# In production, never run with permissive CORS or empty origins.
if not settings.DEBUG and not settings.CORS_ORIGINS:
    raise RuntimeError(
        "CORS_ORIGINS_URL is empty. Set an explicit comma-separated allow-list in production."
    )



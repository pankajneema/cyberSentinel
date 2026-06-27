"""Shared test fixtures. Sets the minimum env so app modules import cleanly."""

import os

# These must be set BEFORE importing config.settings (it fail-fasts otherwise).
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-not-real")
os.environ.setdefault("CORS_ORIGINS_URL", "http://localhost:8080,http://localhost:3000")
os.environ.setdefault("DEBUG", "true")

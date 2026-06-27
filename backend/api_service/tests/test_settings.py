"""Phase 0/3 — config hardening tests."""

import importlib

import pytest


def test_cors_parses_comma_separated_list(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS_URL", "http://a.com, http://b.com ,http://c.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:y@localhost/db")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "secret")
    import config.settings as s

    importlib.reload(s)
    assert s.settings.CORS_ORIGINS == ["http://a.com", "http://b.com", "http://c.com"]


def test_no_hardcoded_secret_fallback(monkeypatch):
    """Legacy JWT secrets must NOT fall back to a guessable default (audit C-1)."""
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:y@localhost/db")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "secret")
    import config.settings as s

    importlib.reload(s)
    assert s.settings.JWT_SECRET == ""
    assert "change-in-production" not in (s.settings.JWT_SECRET or "")


def test_missing_supabase_url_fails_fast(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:y@localhost/db")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    import config.settings as s

    with pytest.raises(RuntimeError):
        importlib.reload(s)

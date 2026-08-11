"""Phase 0/3 — config hardening tests."""

import importlib
import sys

import pytest


def _reload_settings():
    """Reload the `config.settings` *submodule* and return it.

    `import config.settings as s` does NOT give you the submodule here:
    config/__init__.py does `from .settings import settings`, which rebinds
    the `settings` attribute on the `config` package object from the
    submodule to the Settings *instance* (a standard Python import gotcha).
    Since `import x.y as z` resolves `z` via attribute access on `x`, `s`
    ends up being the instance, and `importlib.reload(s)` then fails with
    "reload() argument must be a module". Going through sys.modules sidesteps
    the shadowed attribute entirely.
    """
    import config.settings  # noqa: F401 - ensures it's present in sys.modules

    module = sys.modules["config.settings"]
    importlib.reload(module)
    return module


def test_cors_parses_comma_separated_list(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS_URL", "http://a.com, http://b.com ,http://c.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:y@localhost/db")
    monkeypatch.setenv("JWT_SECRET", "secret")

    module = _reload_settings()
    assert module.settings.CORS_ORIGINS == ["http://a.com", "http://b.com", "http://c.com"]


def test_missing_jwt_secret_fails_fast(monkeypatch):
    """JWT_SECRET must NOT fall back to a guessable default (audit C-1) — the
    only safe behavior for a missing secret is failing fast, not defaulting."""
    # Explicit empty string, not delenv: settings.py calls load_dotenv() on
    # every reload, and python-dotenv's default override=False only skips a
    # key that's already PRESENT in os.environ — a deleted key would get
    # silently repopulated from the real .env file on disk (which does have
    # a real JWT_SECRET for actual local dev use).
    monkeypatch.setenv("JWT_SECRET", "")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x:y@localhost/db")

    with pytest.raises(RuntimeError):
        _reload_settings()

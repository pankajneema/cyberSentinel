"""Internal VS credential endpoint — token gate (fail-closed) tests."""
import pytest
from fastapi import HTTPException

from routes.internal_vs import _require_internal_token


@pytest.mark.asyncio
async def test_fails_closed_when_token_unset(monkeypatch):
    monkeypatch.delenv("CONTROL_PLANE_TOKEN", raising=False)
    with pytest.raises(HTTPException) as e:
        await _require_internal_token(x_internal_token="anything")
    assert e.value.status_code == 503   # never open when unconfigured


@pytest.mark.asyncio
async def test_rejects_wrong_token(monkeypatch):
    monkeypatch.setenv("CONTROL_PLANE_TOKEN", "the-real-secret")
    with pytest.raises(HTTPException) as e:
        await _require_internal_token(x_internal_token="wrong")
    assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_empty_token(monkeypatch):
    monkeypatch.setenv("CONTROL_PLANE_TOKEN", "the-real-secret")
    with pytest.raises(HTTPException) as e:
        await _require_internal_token(x_internal_token="")
    assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_accepts_correct_token(monkeypatch):
    monkeypatch.setenv("CONTROL_PLANE_TOKEN", "the-real-secret")
    # No exception == authorized.
    assert await _require_internal_token(x_internal_token="the-real-secret") is None

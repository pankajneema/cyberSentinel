"""Auth + RBAC unit tests."""

import pytest
from fastapi import HTTPException

from utils.auth import verify_access_token, require_role, CurrentUser


@pytest.mark.asyncio
async def test_garbage_token_rejected():
    with pytest.raises(HTTPException) as exc:
        await verify_access_token("not-a-real-jwt")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_require_role_denies_wrong_role():
    dep = require_role("owner", "admin")
    reader = CurrentUser(user_id="u1", email="r@x.com", role="reader", org_id="o1")
    with pytest.raises(HTTPException) as exc:
        await dep(user=reader)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_role_allows_correct_role():
    dep = require_role("owner", "admin")
    admin = CurrentUser(user_id="u2", email="a@x.com", role="admin", org_id="o1")
    result = await dep(user=admin)
    assert result.role == "admin"

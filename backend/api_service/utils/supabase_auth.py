"""
Supabase authentication for the CyberSentinel API.

Supabase is the identity provider. It owns credentials, email verification,
password reset, OAuth (Google/GitHub), MFA and session/refresh tokens.

This module's job is narrow and important:
  1. Validate the Supabase-issued JWT presented by the frontend (Bearer token).
  2. Extract the verified claims (sub, email, role, app_metadata).
  3. Just-in-time provision / sync a local `profiles` + `organizations` row so
     the rest of the platform can use PostgreSQL as the source of truth for
     application data while trusting Supabase for *identity*.

No passwords are ever handled here. Authorization (tenant isolation + RBAC)
is enforced in the dependencies below, NOT trusted from the client.

Supabase signs project JWTs with HS256 using the project's JWT secret by
default; newer projects can use asymmetric (RS256) keys exposed via JWKS.
Both are supported: set SUPABASE_JWT_SECRET (HS256) or rely on the JWKS URL.
"""

from __future__ import annotations

import time
from typing import Any, Optional

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from utils.database import get_db

# Bearer scheme; auto_error=False so we can return a clean 401.
_bearer = HTTPBearer(auto_error=False)

# Simple in-process JWKS cache (used only for RS256 projects).
_jwks_cache: dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL = 3600  # seconds


async def _get_jwks() -> dict[str, Any]:
    now = time.time()
    if _jwks_cache["keys"] and (now - _jwks_cache["fetched_at"] < _JWKS_TTL):
        return _jwks_cache["keys"]
    url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        keys = resp.json()
    _jwks_cache["keys"] = keys
    _jwks_cache["fetched_at"] = now
    return keys


def _decode_hs256(token: str) -> dict[str, Any]:
    return jwt.decode(
        token,
        settings.SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        audience="authenticated",
        options={"verify_aud": True},
    )


async def _decode_asymmetric(token: str) -> dict[str, Any]:
    """Verify an asymmetric (ES256/RS256) token via the project's JWKS."""
    jwks = await _get_jwks()
    headers = jwt.get_unverified_header(token)
    kid = headers.get("kid")
    alg = headers.get("alg", "ES256")
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        # Refresh once in case keys rotated, then retry.
        _jwks_cache["keys"] = None
        jwks = await _get_jwks()
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        raise JWTError("Signing key not found in JWKS")
    return jwt.decode(
        token,
        key,
        algorithms=[alg],
        audience="authenticated",
        options={"verify_aud": True},
    )


async def verify_supabase_jwt(token: str) -> dict[str, Any]:
    """
    Verify a Supabase access token and return its claims, or raise 401.

    Branch on the token's own algorithm: new Supabase projects sign with
    asymmetric ES256 keys (verified via JWKS); legacy projects use the HS256
    shared secret. The token header tells us which.
    """
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
        if alg == "HS256" and settings.SUPABASE_JWT_SECRET:
            return _decode_hs256(token)
        return await _decode_asymmetric(token)
    except JWTError as exc:  # signature / expiry / audience failures
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


class CurrentUser:
    """Verified identity + resolved tenant/role for the request."""

    def __init__(self, *, user_id: str, email: str, role: str, org_id: Optional[str]):
        self.user_id = user_id          # Supabase sub (uuid)
        self.email = email
        self.role = role                # owner | admin | analyst | reader
        self.org_id = org_id            # tenant root in our PostgreSQL

    def __repr__(self) -> str:  # pragma: no cover
        return f"CurrentUser(email={self.email!r}, role={self.role!r}, org={self.org_id!r})"


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """
    The single authentication entrypoint for protected routes.

    Validates the Supabase JWT, then provisions/syncs the local profile + org
    (just-in-time). Returns a CurrentUser whose org_id/role come from VERIFIED
    state, never from the client request body.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = await verify_supabase_jwt(creds.credentials)

    sub = claims.get("sub")
    email = claims.get("email") or claims.get("user_metadata", {}).get("email")
    if not sub or not email:
        raise HTTPException(status_code=401, detail="Token missing required claims")

    # Role precedence: app_metadata.role (server-controlled) > default reader.
    app_meta = claims.get("app_metadata", {}) or {}
    role = app_meta.get("role") or "reader"

    # Lazy import to avoid a circular import at module load.
    from utils.identity_sync import sync_profile_and_org

    profile = await sync_profile_and_org(
        db,
        supabase_user_id=sub,
        email=email,
        full_name=(claims.get("user_metadata", {}) or {}).get("full_name", email),
        role=role,
        org_name_hint=(claims.get("user_metadata", {}) or {}).get("company_name"),
    )

    return CurrentUser(
        user_id=sub,
        email=email,
        role=profile.role,        # role from our DB (server-owned) wins
        org_id=profile.org_id,
    )


def require_role(*allowed: str):
    """Dependency factory: gate a route to specific roles (server-side RBAC)."""

    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action",
            )
        return user

    return _dep

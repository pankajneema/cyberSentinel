"""
Self-hosted authentication for the CyberSentinel API.

We are the identity provider: this module owns password hashing, JWT
issuance/verification, and (together with routes/oauth.py) OAuth account
linking. No external identity provider is involved.

Design notes:
  - Access tokens are short-lived, stateless HS256 JWTs (settings.JWT_SECRET).
    Single algorithm, pinned server-side — we are the only signer, so there is
    no JWKS/algorithm-negotiation surface to worry about.
  - Refresh tokens are opaque, high-entropy random strings (routes/auth.py),
    persisted only as a SHA-256 hash (see models/user_models.RefreshToken) so
    sessions can actually be revoked — a stateless refresh JWT couldn't
    support "sign out this device" or "sign out everywhere".
  - Passwords are hashed with bcrypt via passlib.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import PyJWTError
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from utils.database import get_db

_bearer = HTTPBearer(auto_error=False)
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


# ---------------------------------------------------------------------------
# Access tokens (self-issued, HS256)
# ---------------------------------------------------------------------------
def create_access_token(*, user_id: str, email: str, role: str, org_id: Optional[str]) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "email": email,
        "role": role,
        "org_id": org_id,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


async def verify_access_token(token: str) -> dict[str, Any]:
    """Verify a self-issued access token and return its claims, or raise 401."""
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ---------------------------------------------------------------------------
# Refresh / password-reset tokens — opaque, high-entropy, hashed at rest.
# Machine-generated and already high-entropy, so a fast hash (SHA-256) is the
# right tool here; bcrypt is reserved for human-chosen passwords above.
# ---------------------------------------------------------------------------
def generate_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Short-lived signed state (OAuth CSRF nonce) — stateless, no DB/Redis needed.
# ---------------------------------------------------------------------------
def create_state_token(*, provider: str, minutes: int = 10) -> str:
    now = datetime.now(timezone.utc)
    claims = {"provider": provider, "type": "oauth_state", "iat": now, "exp": now + timedelta(minutes=minutes)}
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def verify_state_token(token: str, *, provider: str) -> bool:
    try:
        claims = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except PyJWTError:
        return False
    return claims.get("type") == "oauth_state" and claims.get("provider") == provider


# ---------------------------------------------------------------------------
# CurrentUser / get_current_user / require_role — unchanged shape/contract,
# so the 13 route modules that depend on these need no changes at all.
# ---------------------------------------------------------------------------
class CurrentUser:
    """Verified identity + resolved tenant/role for the request."""

    def __init__(self, *, user_id: str, email: str, role: str, org_id: Optional[str]):
        self.user_id = user_id
        self.email = email
        self.role = role  # owner | admin | analyst | reader
        self.org_id = org_id

    def __repr__(self) -> str:  # pragma: no cover
        return f"CurrentUser(email={self.email!r}, role={self.role!r}, org={self.org_id!r})"


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """
    The single authentication entrypoint for protected routes.

    Validates our own access token, then provisions/syncs the local profile +
    org (just-in-time — cheap no-op after the first request). Returns a
    CurrentUser whose org_id/role come from VERIFIED DB state, never from the
    token or request body alone.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = await verify_access_token(creds.credentials)
    if claims.get("type") != "access":
        raise HTTPException(status_code=401, detail="Wrong token type")

    sub = claims.get("sub")
    email = claims.get("email")
    if not sub or not email:
        raise HTTPException(status_code=401, detail="Token missing required claims")

    # Lazy import to avoid a circular import at module load.
    from utils.identity_sync import sync_profile_and_org

    profile = await sync_profile_and_org(
        db,
        user_id=sub,
        email=email,
        # No full_name here: the access token doesn't carry a display name,
        # and passing one (even the email) would clobber the real name set
        # at signup/OAuth on every subsequent request. See identity_sync.py.
    )

    return CurrentUser(
        user_id=sub,
        email=email,
        role=profile.role,  # role from our DB (server-owned) wins over the token claim
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

"""
Google + GitHub OAuth (authorization-code grant), implemented directly here —
there is no external identity provider anymore, so we own this flow.

  GET /auth/oauth/{provider}            -> 302 to the provider's consent screen
  GET /auth/oauth/{provider}/callback   -> exchanges the code, mints our own
                                            tokens, 302s back to the frontend

A provider with no client id/secret configured returns a clean 503 from the
start route rather than crashing — OAuth is additive, not a hard requirement,
so the app works fully on email+password before these are set up.

Tokens are handed back to the frontend via a URL *fragment*
(`#access_token=...&refresh_token=...`), deliberately: fragments are never
sent to any server past the initial navigation (not in Referer headers, not
logged by reverse proxies) — the same reason Supabase's own client used one.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from utils.database import get_db
from utils.auth import create_state_token, verify_state_token
from models.user_models import User, OAuthIdentity
from routes.auth import _mint_tokens

logger = logging.getLogger("cybersentinel.oauth")

router = APIRouter(prefix="/api/v1/auth/oauth", tags=["oauth"])

_PROVIDERS: dict[str, dict[str, Any]] = {
    "google": {
        "client_id": lambda: settings.GOOGLE_CLIENT_ID,
        "client_secret": lambda: settings.GOOGLE_CLIENT_SECRET,
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scope": "openid email profile",
    },
    "github": {
        "client_id": lambda: settings.GITHUB_CLIENT_ID,
        "client_secret": lambda: settings.GITHUB_CLIENT_SECRET,
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "scope": "read:user user:email",
    },
}


def _callback_url(provider: str) -> str:
    return f"{settings.OAUTH_REDIRECT_BASE_URL}/api/v1/auth/oauth/{provider}/callback"


def _fail_redirect(code: str) -> RedirectResponse:
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/login?error={code}", status_code=302)


@router.get("/{provider}")
async def oauth_start(provider: str):
    cfg = _PROVIDERS.get(provider)
    if cfg is None:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")
    client_id = cfg["client_id"]()
    if not client_id:
        raise HTTPException(status_code=503, detail=f"{provider.title()} OAuth is not configured")

    params = {
        "client_id": client_id,
        "redirect_uri": _callback_url(provider),
        "scope": cfg["scope"],
        "state": create_state_token(provider=provider),
        "response_type": "code",
    }
    if provider == "google":
        params["access_type"] = "online"
        params["prompt"] = "select_account"
    return RedirectResponse(url=str(httpx.URL(cfg["authorize_url"], params=params)), status_code=302)


async def _fetch_google_identity(code: str) -> Optional[dict]:
    cfg = _PROVIDERS["google"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(cfg["token_url"], data={
            "client_id": cfg["client_id"](),
            "client_secret": cfg["client_secret"](),
            "code": code,
            "redirect_uri": _callback_url("google"),
            "grant_type": "authorization_code",
        })
        if token_resp.status_code != 200:
            logger.warning("Google token exchange failed: %s", token_resp.text[:300])
            return None
        access_token = token_resp.json().get("access_token")
        if not access_token:
            return None
        userinfo_resp = await client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_resp.status_code != 200:
            return None
        info = userinfo_resp.json()

    email = info.get("email")
    if not email or info.get("email_verified") is False:
        return None
    return {
        "provider_user_id": info.get("sub"),
        "email": email,
        "full_name": info.get("name") or email,
    }


async def _fetch_github_identity(code: str) -> Optional[dict]:
    cfg = _PROVIDERS["github"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(
            cfg["token_url"],
            data={
                "client_id": cfg["client_id"](),
                "client_secret": cfg["client_secret"](),
                "code": code,
                "redirect_uri": _callback_url("github"),
            },
            headers={"Accept": "application/json"},
        )
        if token_resp.status_code != 200:
            logger.warning("GitHub token exchange failed: %s", token_resp.text[:300])
            return None
        access_token = token_resp.json().get("access_token")
        if not access_token:
            return None
        headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"}
        user_resp = await client.get("https://api.github.com/user", headers=headers)
        if user_resp.status_code != 200:
            return None
        user_info = user_resp.json()
        emails_resp = await client.get("https://api.github.com/user/emails", headers=headers)
        emails = emails_resp.json() if emails_resp.status_code == 200 else []

    # GitHub's primary profile email can be private/unset — only trust a
    # verified, primary address from the emails endpoint.
    verified_primary = next(
        (e["email"] for e in emails if e.get("primary") and e.get("verified")), None,
    )
    if not verified_primary:
        return None
    return {
        "provider_user_id": str(user_info.get("id")),
        "email": verified_primary,
        "full_name": user_info.get("name") or user_info.get("login") or verified_primary,
    }


_FETCHERS = {"google": _fetch_google_identity, "github": _fetch_github_identity}


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    if provider not in _PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")
    if error or not code or not state or not verify_state_token(state, provider=provider):
        return _fail_redirect(f"{provider}_failed")

    identity = await _FETCHERS[provider](code)
    if identity is None:
        return _fail_redirect(f"{provider}_no_email" if provider == "github" else f"{provider}_failed")

    oauth_row = (
        await db.execute(
            select(OAuthIdentity).where(
                OAuthIdentity.provider == provider,
                OAuthIdentity.provider_user_id == identity["provider_user_id"],
            )
        )
    ).scalar_one_or_none()

    if oauth_row is not None:
        user = (await db.execute(select(User).where(User.id == oauth_row.user_id))).scalar_one_or_none()
        if user is None:
            return _fail_redirect(f"{provider}_failed")
    else:
        # Find-or-create by verified email: covers "signed up with a password,
        # now trying Google/GitHub" by linking rather than duplicating the account.
        user = (await db.execute(select(User).where(User.email == identity["email"]))).scalar_one_or_none()
        if user is None:
            user = User(email=identity["email"], full_name=identity["full_name"], password_hash=None)
            db.add(user)
            await db.flush()  # get user.id
        db.add(OAuthIdentity(
            user_id=user.id,
            provider=provider,
            provider_user_id=identity["provider_user_id"],
            email=identity["email"],
        ))

    user.last_login_at = datetime.utcnow()
    tokens = await _mint_tokens(db, user)

    redirect_url = (
        f"{settings.FRONTEND_URL}/auth/callback"
        f"#access_token={tokens.access_token}&refresh_token={tokens.refresh_token}&token_type=bearer"
    )
    return RedirectResponse(url=redirect_url, status_code=302)

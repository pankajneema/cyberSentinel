"""
Supabase provisioning webhook.

Configure a Supabase **Database Webhook** on the `auth.users` table (INSERT +
DELETE) pointing at `POST /auth/webhook/supabase`, with a custom header
`x-webhook-secret: <SUPABASE_WEBHOOK_SECRET>`.

This gives robust, event-driven provisioning in addition to the lazy
just-in-time sync in `get_current_user`:
  - INSERT  -> create the member profile + org for the new user.
  - DELETE  -> soft-delete the member profile(s) for that user.

The endpoint is unauthenticated by design (Supabase calls it), so it is
protected by a constant-time shared-secret comparison.
"""

from __future__ import annotations

import hmac
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from utils.database import get_db
from models.tenancy_models import MemberProfile, AuditLog
from datetime import datetime

router = APIRouter(prefix="/api/v1/auth/webhook", tags=["auth-webhook"])


def _verify_secret(provided: Optional[str]) -> None:
    expected = settings.SUPABASE_WEBHOOK_SECRET
    if not expected:
        # Misconfigured server: refuse rather than accept unauthenticated calls.
        raise HTTPException(status_code=503, detail="Webhook secret not configured")
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad webhook secret")


@router.post("/supabase")
async def supabase_user_event(
    payload: dict[str, Any],
    x_webhook_secret: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _verify_secret(x_webhook_secret)

    event_type = (payload.get("type") or "").upper()
    record = payload.get("record") or {}
    old = payload.get("old_record") or {}

    if event_type == "INSERT":
        sub = record.get("id")
        email = record.get("email")
        meta = record.get("raw_user_meta_data") or {}
        if sub and email:
            from utils.identity_sync import sync_profile_and_org

            await sync_profile_and_org(
                db,
                supabase_user_id=sub,
                email=email,
                full_name=meta.get("full_name", email),
                role="reader",
                org_name_hint=meta.get("company_name"),
            )
            db.add(AuditLog(actor_user_id=sub, action="user.created", target=email, meta={}))
            await db.commit()
        return {"ok": True, "handled": "INSERT"}

    if event_type == "DELETE":
        sub = old.get("id") or record.get("id")
        if sub:
            rows = (
                await db.execute(
                    select(MemberProfile).where(MemberProfile.supabase_user_id == sub)
                )
            ).scalars().all()
            for p in rows:
                p.is_active = False
                p.deleted_at = datetime.utcnow()
            db.add(AuditLog(actor_user_id=sub, action="user.deleted", target=sub, meta={}))
            await db.commit()
        return {"ok": True, "handled": "DELETE"}

    # Ignore other events (UPDATE handled by JIT sync on next request).
    return {"ok": True, "handled": "ignored", "type": event_type}

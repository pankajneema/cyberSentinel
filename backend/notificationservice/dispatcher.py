"""
Central notification dispatcher.

`dispatch()` is the single place every notification flows through. It:
  1. Persists an in-app Notification row per org member (gated by each member's
     in_app preference) so the panel/bell reflects real events.
  2. Reads the discovery owner's ASM notification settings and, if the relevant
     rule toggle is enabled, fans out to the configured channels — email
     recipients, Slack webhook, Teams webhook.
  3. Publishes a realtime event so connected WebSocket clients update live.

It is best-effort: a channel failure is logged and never propagated to the
caller (a scan must not fail because Slack is down).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenancy_models import MemberProfile
from models.notification_models import Notification, NotificationPreference
from models.asm_models import AsmSettings

from notificationservice import events as ev
from notificationservice import channels
from notificationservice import realtime

logger = logging.getLogger(__name__)


async def _org_member_ids(db: AsyncSession, org_id: str) -> list[str]:
    rows = (
        await db.execute(
            select(MemberProfile.user_id).where(
                MemberProfile.org_id == org_id,
                MemberProfile.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return [r for r in rows if r]


async def _in_app_disabled(db: AsyncSession, user_ids: list[str]) -> set[str]:
    """Return the set of user_ids that have turned OFF in-app notifications."""
    if not user_ids:
        return set()
    rows = (
        await db.execute(
            select(NotificationPreference.user_id).where(
                NotificationPreference.user_id.in_(user_ids),
                NotificationPreference.in_app.is_(False),
            )
        )
    ).scalars().all()
    return set(rows)


async def _owner_notification_settings(db: AsyncSession, owner_user_id: Optional[str]) -> dict:
    if not owner_user_id:
        return {}
    row = (
        await db.execute(select(AsmSettings).where(AsmSettings.user_id == owner_user_id))
    ).scalar_one_or_none()
    if not row or not isinstance(row.settings, dict):
        return {}
    notif = row.settings.get("notifications")
    return notif if isinstance(notif, dict) else {}


def _rule_enabled(notif_settings: dict, event_type: str) -> bool:
    """Whether outbound (email/slack/teams) delivery is allowed for this event.

    Events with no mapped rule are in-app/realtime only — we do NOT push them to
    email/Slack by default (that would spam on every scan start/stop). Mapped
    events are pushed only when the user has the toggle on."""
    rule = ev.RULE_FOR_EVENT.get(event_type)
    if rule is None:
        return False
    return bool(notif_settings.get(rule, True))


async def dispatch(
    db: AsyncSession | None,  # kept for call-site compatibility; NOT used (see below)
    org_id: str,
    event_type: str,
    title: str,
    body: str = "",
    severity: str = "info",
    link: Optional[str] = None,
    meta: Optional[dict] = None,
    owner_user_id: Optional[str] = None,
    to_user: Optional[str] = None,
    exclude_user: Optional[str] = None,
) -> None:
    if not org_id:
        return
    now = datetime.utcnow()
    meta = meta or {}

    # Use a dedicated session for all notification DB work. Borrowing the
    # caller's request-scoped session and committing it would flush the caller's
    # uncommitted mutations (or wipe them on rollback) as a side effect — a
    # latent footgun. A fresh session isolates persistence completely.
    from utils.database import AsyncSessionLocal

    notif_settings: dict = {}
    async with AsyncSessionLocal() as sdb:
        # 1) In-app persistence (per member, honoring in_app preference).
        recipients = [to_user] if to_user else await _org_member_ids(sdb, org_id)
        if exclude_user:
            recipients = [r for r in recipients if r != exclude_user]
        disabled = await _in_app_disabled(sdb, recipients)
        try:
            for uid in recipients:
                if uid in disabled:
                    continue
                sdb.add(Notification(
                    org_id=org_id, user_id=uid, title=title, body=body or None,
                    type=event_type, link=link, is_read=False, created_at=now,
                ))
            await sdb.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning("notification persist failed: %s", e)
            await sdb.rollback()

        # Read the owner's channel settings on the same isolated session.
        try:
            notif_settings = await _owner_notification_settings(sdb, owner_user_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("loading notification settings failed: %s", e)
            notif_settings = {}

    # 2) Realtime push (always — the panel must reflect reality).
    payload = {
        "id": str(uuid.uuid4()),
        "org_id": org_id,
        "type": event_type,
        "title": title,
        "body": body,
        "severity": severity,
        "link": link,
        "meta": meta,
        "created_at": now.isoformat(),
    }
    if to_user:
        payload["to_user"] = to_user
    try:
        await realtime.publish_event(payload)
    except Exception as e:  # noqa: BLE001
        logger.warning("realtime publish failed: %s", e)

    # 3) Outbound channels (gated by the owner's rule toggles; settings were
    #    loaded above on the isolated session).
    try:
        if notif_settings and _rule_enabled(notif_settings, event_type):
            text = f"*{title}*\n{body}" if body else f"*{title}*"
            slack_url = (notif_settings.get("slack_webhook") or "").strip()
            teams_url = (notif_settings.get("teams_webhook") or "").strip()
            email_to = notif_settings.get("email_recipients") or ""
            if slack_url:
                await channels.post_slack(slack_url, text)
            if teams_url:
                await channels.post_teams(teams_url, text)
            if email_to:
                subject = f"[CyberSentinel] {title}"
                html = f"<p>{body or title}</p>" + (f'<p><a href="{link}">View</a></p>' if link else "")
                await channels.send_email_async(
                    [e.strip() for e in str(email_to).replace(";", ",").split(",")],
                    subject, html,
                )
    except Exception as e:  # noqa: BLE001
        logger.warning("outbound channel dispatch failed: %s", e)


async def acquire_once(key: str, ttl_seconds: int = 3600) -> bool:
    """Cross-replica dedup lock. Returns True to exactly one caller per `key`.

    Used so that when multiple API replicas receive the same worker event over
    Redis pub/sub, only one performs the side-effecting dispatch (persist/email/
    slack). If Redis is unavailable, returns True (best-effort, single-process).
    """
    try:
        from utils.redis_client import get_redis

        redis = await get_redis()
        if redis is None:
            return True
        return bool(await redis.set(f"rtlock:{key}", "1", nx=True, ex=ttl_seconds))
    except Exception:  # noqa: BLE001
        return True

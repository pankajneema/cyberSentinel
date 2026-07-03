"""
Outbound notification channels: Slack / Microsoft Teams incoming webhooks and
email. These are the *real* senders wired to the ASM settings a user configures.

All senders are best-effort and never raise into the caller — a failed webhook
must not break scan processing. They return True on success, False otherwise.
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(8.0, connect=4.0)


async def post_slack(webhook_url: str, text: str) -> bool:
    """Post a simple message to a Slack incoming webhook."""
    return await _post_webhook(webhook_url, {"text": text}, "slack")


async def post_teams(webhook_url: str, text: str) -> bool:
    """Post to a Microsoft Teams incoming webhook.

    Teams' legacy connector accepts a simple ``{"text": ...}`` payload (Markdown).
    """
    return await _post_webhook(webhook_url, {"text": text}, "teams")


async def _post_webhook(url: str, payload: dict, kind: str) -> bool:
    if not url or not url.lower().startswith(("http://", "https://")):
        return False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=payload)
        if resp.status_code >= 300:
            logger.warning("%s webhook returned %s: %s", kind, resp.status_code, resp.text[:200])
            return False
        return True
    except Exception as e:  # noqa: BLE001 - best-effort channel
        logger.warning("%s webhook failed: %s", kind, e)
        return False


async def send_email_async(to_emails: Iterable[str], subject: str, body_html: str) -> int:
    """Send an email to each recipient via the existing SMTP emailer.

    `send_email` is synchronous/blocking; run it in a thread so the event loop is
    not blocked. Returns the count of recipients the emailer accepted.
    """
    import asyncio
    from utils.emailer import send_email

    sent = 0
    for addr in _clean(to_emails):
        try:
            ok = await asyncio.to_thread(send_email, addr, subject, body_html, True)
            if ok:
                sent += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("email to %s failed: %s", addr, e)
    return sent


def _clean(values: Optional[Iterable[str]]) -> list[str]:
    out: list[str] = []
    for v in values or []:
        for part in str(v).replace(";", ",").split(","):
            p = part.strip()
            if p and "@" in p and p not in out:
                out.append(p)
    return out

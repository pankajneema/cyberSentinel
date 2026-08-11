"""
Realtime WebSocket endpoint.

    ws(s)://<host>/ws/realtime?token=<access-token>

Delivers realtime notifications (ASM scan lifecycle, findings, panel/team
messages) to the authenticated user's org, and accepts inbound team messages
which are broadcast to the org and persisted as notifications.

Auth: browsers can't set Authorization headers on a WebSocket, so the access
token is passed as the `token` query param (or, preferably, the WS subprotocol
below) and verified the same way as the REST auth dependency (signature +
expiry).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select

from utils.database import AsyncSessionLocal
from utils.auth import verify_access_token
from models.tenancy_models import MemberProfile
from notificationservice import realtime, dispatcher
from notificationservice import events as ev

logger = logging.getLogger(__name__)
router = APIRouter(tags=["realtime"])


async def _resolve_identity(token: str) -> tuple[str, str] | None:
    """Verify the token and resolve (user_id, org_id). None if unauthenticated."""
    try:
        claims = await verify_access_token(token)
        sub = claims.get("sub")
        if not sub:
            return None
        async with AsyncSessionLocal() as db:
            # `.limit(1)` + first(): a user with multiple memberships must not
            # crash the handshake (scalar_one_or_none would raise). Ordered so
            # selection is deterministic.
            member = (
                await db.execute(
                    select(MemberProfile).where(
                        MemberProfile.user_id == sub,
                        MemberProfile.deleted_at.is_(None),
                    ).order_by(MemberProfile.created_at.asc()).limit(1)
                )
            ).scalars().first()
        org_id = member.org_id if member else None
        if not org_id:
            return None
        return sub, org_id
    except Exception:  # noqa: BLE001 - invalid/expired token or lookup failure
        return None


# Sentinel subprotocol name. The browser connects with
#   new WebSocket(url, ["cybersentinel-auth", <token>])
# so the JWT travels as a subprotocol value (kept out of the request URL / access
# logs / browser history). The server echoes only the sentinel, never the token.
_AUTH_PROTO = "cybersentinel-auth"


def _token_from_subprotocol(websocket: WebSocket) -> tuple[str, str | None]:
    """Return (token, subprotocol_to_echo). Falls back to ('', None)."""
    header = websocket.headers.get("sec-websocket-protocol")
    if not header:
        return "", None
    parts = [p.strip() for p in header.split(",") if p.strip()]
    if len(parts) >= 2 and parts[0] == _AUTH_PROTO:
        return parts[1], _AUTH_PROTO
    return "", None


@router.websocket("/ws/realtime")
async def realtime_ws(websocket: WebSocket, token: str = Query(default="")):
    # Prefer the subprotocol-carried token (not logged); fall back to the query
    # param for non-browser clients (curl/tests).
    proto_token, echo_proto = _token_from_subprotocol(websocket)
    auth_token = proto_token or token

    identity = await _resolve_identity(auth_token)
    if identity is None:
        # 1008 = policy violation (unauthenticated).
        await websocket.close(code=1008)
        return
    user_id, org_id = identity

    await realtime.manager.connect(websocket, org_id, user_id, subprotocol=echo_proto)
    # Greet so the client can confirm the channel is live.
    try:
        await websocket.send_json({"type": "connected", "org_id": org_id})
    except Exception:  # noqa: BLE001
        pass

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = (data or {}).get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            elif msg_type == "chat":
                text = (data.get("text") or "").strip()
                if not text:
                    continue
                # Team internal message -> broadcast to org + persist.
                async with AsyncSessionLocal() as db:
                    await dispatcher.dispatch(
                        db, org_id, ev.TEAM_MESSAGE,
                        title=data.get("title") or "Team message",
                        body=text[:2000],
                        severity="info",
                        meta={"from": user_id},
                        exclude_user=user_id,  # don't notify the sender of their own message
                    )
            # Unknown message types are ignored.
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.info("ws closed for user=%s: %s", user_id, e)
    finally:
        await realtime.manager.disconnect(websocket, org_id, user_id)

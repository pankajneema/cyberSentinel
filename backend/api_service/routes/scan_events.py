"""Server-Sent Events stream of live scan task/stage progress.

    GET /api/v1/scans/events?token=<supabase-access-token>

The Go worker publishes task/stage events to the Redis pub/sub channel
``task_events:{org_id}`` (see worker/core/events.go). This endpoint subscribes to
the caller's org channel and streams each event to the browser as SSE. The
browser never touches Redis directly.

Auth: EventSource can't set Authorization headers, so the Supabase access token
is passed as the ``token`` query param and verified exactly like the WebSocket
endpoint (reusing its identity resolver).
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from routes.ws import _resolve_identity  # token -> (user_id, org_id)
from utils.redis_client import get_redis
from utils.scan_contracts import cancel_key, events_channel, task_key
from utils.supabase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/scans", tags=["scan-events"])

# Seconds between keepalive comments when the channel is idle, so proxies don't
# drop the long-lived connection.
_HEARTBEAT_SECS = 15.0


@router.get("/events")
async def scan_events(request: Request, token: str = Query(default="")):
    identity = await _resolve_identity(token)
    if identity is None:
        raise HTTPException(status_code=401, detail="unauthenticated")
    _user_id, org_id = identity

    redis = await get_redis()
    if redis is None:
        raise HTTPException(status_code=503, detail="realtime unavailable")

    channel = events_channel(org_id)

    async def event_stream():
        pubsub = redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            # Open the stream immediately so the client's onopen fires.
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=_HEARTBEAT_SECS
                    )
                except asyncio.CancelledError:
                    break
                if msg is None:
                    yield ": ping\n\n"  # keepalive comment
                    continue
                data = msg.get("data")
                if not data:
                    continue
                # decode_responses=True → data is already a str (the event JSON).
                yield f"data: {data}\n\n"
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()
            except Exception:  # noqa: BLE001 - best-effort cleanup
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering for SSE
        },
    )


@router.post("/{task_id}/cancel")
async def cancel_scan(task_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Request cooperative cancellation of a running scan. Sets task:{id}:cancel;
    the worker stops cleanly between stages and transitions the task to CANCELLED.
    Org-scoped: the task's live state must belong to the caller's org."""
    redis = await get_redis()
    if redis is None:
        raise HTTPException(status_code=503, detail="realtime unavailable")

    raw = await redis.get(task_key(task_id))
    if not raw:
        raise HTTPException(status_code=404, detail="task not found or already finished")
    try:
        state = json.loads(raw)
    except (ValueError, TypeError):
        state = {}
    task_org = state.get("org_id")
    if task_org and current_user.org_id and task_org != current_user.org_id:
        raise HTTPException(status_code=403, detail="forbidden")

    await redis.set(cancel_key(task_id), "1", ex=86400)
    return {"cancel_requested": True, "task_id": task_id}

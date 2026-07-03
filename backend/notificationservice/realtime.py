"""
Realtime WebSocket fan-out for CyberSentinel.

Design (multi-replica safe):
  * Each API process holds its own set of live WebSocket connections, grouped by
    org. A `ConnectionManager` broadcasts to the sockets it owns.
  * Cross-process delivery rides Redis pub/sub. `publish_event()` publishes to the
    `rt:events` channel; every API replica runs `run_subscriber()`, receives the
    event, and broadcasts to *its* local sockets. This is how an event produced in
    the worker-event subscriber or in one API replica reaches a browser connected
    to a different replica.
  * If Redis is unavailable we fall back to a purely local broadcast so
    single-process/dev setups still work.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

RT_CHANNEL = "rt:events"


class ConnectionManager:
    def __init__(self) -> None:
        # org_id -> set of (websocket, user_id)
        self._by_org: dict[str, set[tuple[Any, str]]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws, org_id: str, user_id: str, subprotocol: str | None = None) -> None:
        # Echo the negotiated subprotocol when the client authenticated via one,
        # so the browser's WebSocket handshake completes cleanly.
        await ws.accept(subprotocol=subprotocol)
        async with self._lock:
            self._by_org.setdefault(org_id, set()).add((ws, user_id))
        logger.info("ws connected org=%s user=%s (local=%d)", org_id, user_id, self.local_count())

    async def disconnect(self, ws, org_id: str, user_id: str) -> None:
        async with self._lock:
            conns = self._by_org.get(org_id)
            if conns:
                conns.discard((ws, user_id))
                if not conns:
                    self._by_org.pop(org_id, None)

    def local_count(self) -> int:
        return sum(len(s) for s in self._by_org.values())

    async def broadcast_org(self, org_id: str, payload: dict) -> None:
        """Send to every local socket in the org, concurrently and with a
        per-socket timeout so one slow/dead client can't stall delivery to the
        others (head-of-line blocking). Targeted delivery is honored: if payload
        has `to_user`, only that recipient's sockets get it."""
        if not org_id:
            return
        to_user = payload.get("to_user")
        async with self._lock:
            targets = [
                (ws, uid) for (ws, uid) in self._by_org.get(org_id, set())
                if not to_user or uid == to_user
            ]
        if not targets:
            return

        async def _safe_send(ws, uid):
            try:
                await asyncio.wait_for(ws.send_json(payload), timeout=5.0)
                return None
            except Exception:  # noqa: BLE001 - timeout or dead socket
                return (ws, uid)

        results = await asyncio.gather(*[_safe_send(ws, uid) for ws, uid in targets])
        dead = [r for r in results if r is not None]
        if dead:
            async with self._lock:
                conns = self._by_org.get(org_id)
                if conns:
                    for d in dead:
                        conns.discard(d)


manager = ConnectionManager()


async def publish_event(payload: dict) -> None:
    """Publish an event for realtime fan-out across all replicas.

    Requires `payload["org_id"]`. Uses Redis pub/sub when available; otherwise
    broadcasts to this process's local sockets directly.
    """
    org_id = payload.get("org_id")
    if not org_id:
        return
    try:
        from utils.redis_client import get_redis

        redis = await get_redis()
    except Exception:  # noqa: BLE001
        redis = None

    if redis is not None:
        try:
            await redis.publish(RT_CHANNEL, json.dumps(payload, default=str))
            return
        except Exception as e:  # noqa: BLE001
            logger.warning("redis publish failed, falling back to local broadcast: %s", e)

    # No Redis — local only.
    await manager.broadcast_org(org_id, payload)


async def run_subscriber(stop_event: asyncio.Event | None = None) -> None:
    """Background task: subscribe to `rt:events` and fan out to local sockets.

    Reconnects on failure. Started once per API process at startup.
    """
    from utils.redis_client import get_redis

    while stop_event is None or not stop_event.is_set():
        redis = None
        pubsub = None
        try:
            redis = await get_redis()
            if redis is None:
                await asyncio.sleep(5)
                continue
            pubsub = redis.pubsub()
            await pubsub.subscribe(RT_CHANNEL)
            logger.info("realtime subscriber listening on %s", RT_CHANNEL)
            async for msg in pubsub.listen():
                if msg is None or msg.get("type") != "message":
                    continue
                try:
                    payload = json.loads(msg["data"])
                except (ValueError, TypeError):
                    continue
                await manager.broadcast_org(payload.get("org_id", ""), payload)
                if stop_event is not None and stop_event.is_set():
                    break
            # listen() ended without raising (clean server close) — back off so
            # we don't spin a tight reconnect loop.
            await asyncio.sleep(2)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning("realtime subscriber error, retrying in 5s: %s", e)
            await asyncio.sleep(5)
        finally:
            if pubsub is not None:
                try:
                    await pubsub.aclose()
                except Exception:  # noqa: BLE001
                    pass

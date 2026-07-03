"""
Redis-backed rate limiting (audit S-3 / API4:2023).

A lightweight fixed-window limiter applied as middleware:
  - Auth endpoints (`/auth/*` POST) get a tight per-IP limit (brute-force / stuffing).
  - All other write methods (POST/PUT/PATCH/DELETE) get a looser per-IP limit.

Fail-open: if Redis is unavailable the request proceeds (availability over
strictness), but a warning is logged. Tune limits via env.
"""

from __future__ import annotations

import logging
import os
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("cybersentinel.ratelimit")

AUTH_LIMIT = int(os.getenv("RATE_LIMIT_AUTH_PER_MIN", "10"))
WRITE_LIMIT = int(os.getenv("RATE_LIMIT_WRITE_PER_MIN", "120"))
WINDOW_SECONDS = 60

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Number of trusted reverse-proxy hops in front of the app. `X-Forwarded-For` is
# client-controlled and MUST NOT be trusted blindly — a spoofed header would
# rotate the limiter bucket key and bypass the limit entirely. Only the value
# appended by our own proxy (the Nth-from-right entry) is trustworthy. Default 0
# = ignore XFF and use the real socket peer.
TRUSTED_PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "0"))


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if TRUSTED_PROXY_HOPS > 0:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            chain = [p.strip() for p in fwd.split(",") if p.strip()]
            # The rightmost entries are appended by infrastructure closest to us;
            # take the one our trusted proxy set, not the leftmost client-spoofable one.
            if len(chain) >= TRUSTED_PROXY_HOPS:
                return chain[-TRUSTED_PROXY_HOPS]
    return peer


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        method = request.method
        path = request.url.path

        # Only meter sensitive surfaces.
        is_auth = path.startswith("/api/v1/auth") and method == "POST"
        is_write = method in _WRITE_METHODS
        if not (is_auth or is_write):
            return await call_next(request)

        limit = AUTH_LIMIT if is_auth else WRITE_LIMIT
        bucket = "auth" if is_auth else "write"
        window = int(time.time() // WINDOW_SECONDS)
        key = f"rl:{bucket}:{_client_ip(request)}:{window}"

        try:
            from utils.redis_client import get_redis

            redis = await get_redis()
            if redis is not None:
                count = await redis.incr(key)
                if count == 1:
                    await redis.expire(key, WINDOW_SECONDS)
                if count > limit:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Rate limit exceeded. Try again shortly."},
                        headers={"Retry-After": str(WINDOW_SECONDS)},
                    )
        except Exception as exc:  # fail-open
            logger.warning("Rate limiter unavailable (%s) — allowing request", exc)

        return await call_next(request)


def install_rate_limit(app: FastAPI) -> None:
    app.add_middleware(RateLimitMiddleware)

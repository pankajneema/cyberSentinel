"""
HTTP hardening: security headers + a global exception handler.

- Security headers close audit finding M-1 (no HSTS/CSP/X-Frame-Options).
- The exception handler closes audit finding H-6 (stack traces / str(e) leaked
  to clients). Internal errors are logged with a correlation id; clients get a
  generic message.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("cybersentinel.api")

_SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for key, value in _SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response


def install_hardening(app: FastAPI) -> None:
    """Attach security headers + a catch-all exception handler to the app."""

    app.add_middleware(SecurityHeadersMiddleware)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):  # noqa: ANN001
        correlation_id = str(uuid.uuid4())
        logger.exception(
            "Unhandled error [%s] on %s %s", correlation_id, request.method, request.url.path
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "An internal error occurred.",
                "correlation_id": correlation_id,
            },
        )

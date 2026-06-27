"""
Observability — SKELETON (Phase 3 placeholder).

Intentionally minimal: this wires the *shape* of metrics, tracing, error
tracking and structured logging so the full implementation can drop in later
without touching call sites. Everything here is optional and no-ops unless the
relevant env/deps are present, so importing/installing it is safe today.

Planned (see docs/OBSERVABILITY.md):
  - Prometheus metrics  -> /metrics endpoint
  - OpenTelemetry traces -> OTLP collector
  - Sentry error tracking
  - Structured JSON logging -> log shipper
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("cybersentinel")


def configure_logging() -> None:
    """Baseline structured-ish logging. Swap for JSON formatter + shipper later."""
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def init_sentry() -> None:
    """No-op unless SENTRY_DSN is set and sentry-sdk is installed."""
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return
    try:
        import sentry_sdk  # type: ignore

        sentry_sdk.init(dsn=dsn, traces_sample_rate=0.1)
        logger.info("Sentry initialized")
    except Exception as exc:  # pragma: no cover
        logger.warning("Sentry not initialized: %s", exc)


def init_tracing(app) -> None:  # noqa: ANN001
    """No-op unless OTEL is configured. Placeholder for OpenTelemetry FastAPI."""
    if not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # type: ignore

        FastAPIInstrumentor.instrument_app(app)
        logger.info("OpenTelemetry tracing enabled")
    except Exception as exc:  # pragma: no cover
        logger.warning("Tracing not initialized: %s", exc)


def install_metrics(app) -> None:  # noqa: ANN001
    """
    Placeholder /metrics endpoint. Returns 501 until a real Prometheus registry
    (prometheus-fastapi-instrumentator) is wired in.
    """
    from fastapi.responses import PlainTextResponse

    @app.get("/metrics")
    async def _metrics():  # pragma: no cover
        return PlainTextResponse(
            "# metrics not yet implemented — see docs/OBSERVABILITY.md\n",
            status_code=501,
        )


def install_observability(app) -> None:  # noqa: ANN001
    """Single entrypoint called from main.py."""
    configure_logging()
    init_sentry()
    init_tracing(app)
    install_metrics(app)

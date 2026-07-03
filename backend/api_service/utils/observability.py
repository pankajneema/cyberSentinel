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


async def _dependency_up() -> dict[str, int]:
    """Live 1/0 liveness for critical dependencies (shared by /metrics + /readyz)."""
    up = {"database": 0, "redis": 0, "rabbitmq": 0}
    try:
        from sqlalchemy import text
        from utils.database import AsyncSessionLocal
        async with AsyncSessionLocal() as s:
            await s.execute(text("SELECT 1"))
        up["database"] = 1
    except Exception:  # noqa: BLE001
        pass
    try:
        from utils.redis_client import get_redis
        client = await get_redis()
        if client is not None:
            await client.ping()
            up["redis"] = 1
    except Exception:  # noqa: BLE001
        pass
    try:
        from utils.queue import get_queue_connection
        conn = await get_queue_connection()
        if conn is not None and not conn.is_closed:
            up["rabbitmq"] = 1
    except Exception:  # noqa: BLE001
        pass
    return up


def install_metrics(app) -> None:  # noqa: ANN001
    """
    Real /metrics endpoint in Prometheus text-exposition format — no extra
    dependency required. Emits process + dependency-liveness gauges. Swap for
    prometheus-fastapi-instrumentator later for full request histograms.
    """
    import resource
    from fastapi.responses import PlainTextResponse

    @app.get("/metrics")
    async def _metrics():
        deps = await _dependency_up()
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        lines = [
            "# HELP cybersentinel_up Service is up (1).",
            "# TYPE cybersentinel_up gauge",
            "cybersentinel_up 1",
            "# HELP cybersentinel_dependency_up Dependency liveness (1=up,0=down).",
            "# TYPE cybersentinel_dependency_up gauge",
        ]
        for dep, val in deps.items():
            lines.append(f'cybersentinel_dependency_up{{dependency="{dep}"}} {val}')
        lines += [
            "# HELP process_max_resident_memory_bytes Peak RSS (platform units).",
            "# TYPE process_max_resident_memory_bytes gauge",
            f"process_max_resident_memory_bytes {rss}",
        ]
        return PlainTextResponse("\n".join(lines) + "\n")


def install_observability(app) -> None:  # noqa: ANN001
    """Single entrypoint called from main.py."""
    configure_logging()
    init_sentry()
    init_tracing(app)
    install_metrics(app)

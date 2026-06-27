# Observability — plan (skeleton in place)

The scaffolding exists (`utils/observability.py`, wired in `main.py`); the full
stack is intentionally deferred. This doc is the target state.

## Current (skeleton)
- Baseline logging via `configure_logging()`.
- Optional Sentry init (no-op unless `SENTRY_DSN` set).
- Optional OpenTelemetry init (no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` set).
- `/metrics` endpoint stub (returns 501 until a real registry is wired).
- Deep readiness probe `/readyz` (already checks DB + Redis).

## To implement (Phase 3 → later)
1. **Metrics** — add `prometheus-fastapi-instrumentator`; expose real `/metrics`
   (request rate/latency/errors, per-route). Add Go worker metrics (jobs
   processed, durations, queue depth, DLQ count).
2. **Tracing** — OpenTelemetry FastAPI + SQLAlchemy + httpx instrumentation,
   export OTLP to a collector (Tempo/Jaeger). Propagate trace context into the
   Go workers across RabbitMQ.
3. **Error tracking** — enable Sentry in API + frontend with release tagging.
4. **Logging** — JSON formatter + correlation id (the exception handler already
   emits one), ship to Loki/ELK/CloudWatch.
5. **SLOs & alerting** — define golden-signal SLOs; alert on error budget burn,
   DLQ growth, readiness failures.

## Env
```
LOG_LEVEL=INFO
SENTRY_DSN=...                      # enables Sentry
OTEL_EXPORTER_OTLP_ENDPOINT=...     # enables tracing
```

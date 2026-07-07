# Reporting consumer — multi-stage, non-root. (No HTTP port; it consumes from
# RabbitMQ.) Pin base images by digest in production.

# ---- build ----
FROM python:3.11-slim AS build
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /build
COPY backend/reporting/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- runtime ----
FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=build /install /usr/local
WORKDIR /app
COPY backend /app/backend
# api_service must be on the path: its modules use bare internal imports
# (from utils.database import Base) even when imported as backend.api_service.*
ENV PYTHONPATH=/app:/app/backend:/app/backend/api_service

RUN useradd --create-home --uid 10002 reporter && chown -R reporter /app
USER reporter

CMD ["python", "/app/backend/reporting/asm/main.py"]

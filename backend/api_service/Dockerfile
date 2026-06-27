# API service — multi-stage, non-root, with a healthcheck.
# Pin base images by digest in production (replace tags with @sha256:...).

# ---- build: install deps into an isolated prefix ----
FROM python:3.11-slim AS build
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /build
COPY backend/api_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- runtime: slim, non-root ----
FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Copy installed packages from the build stage (no build tools in runtime).
COPY --from=build /install /usr/local
# App code (.dockerignore keeps .env and cruft out).
WORKDIR /app/backend/api_service
COPY backend /app/backend
ENV PYTHONPATH=/app/backend:/app/backend/api_service

# Non-root user.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy full backend to keep relative paths consistent
COPY backend /app/backend

# Install reporting deps (includes api_service deps via -r)
RUN pip install --no-cache-dir -r /app/backend/reporting/requirements.txt

ENV PYTHONPATH=/app:/app/backend

CMD ["python", "/app/backend/reporting/asm/main.py"]

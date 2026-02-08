FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/api_service/requirements.txt /app/backend/api_service/requirements.txt
COPY backend/reporting/requirements.txt /app/backend/reporting/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/reporting/requirements.txt

COPY backend /app/backend

ENV PYTHONPATH=/app

CMD ["python", "/app/backend/reporting/asm/main.py"]

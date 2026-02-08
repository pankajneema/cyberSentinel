FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend/api_service

COPY backend/api_service/requirements.txt /app/backend/api_service/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/api_service/requirements.txt

COPY backend /app/backend

ENV PYTHONPATH=/app/backend:/app/backend/api_service

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# Reporting Module - Running Guide

## Setup

### 1. Install Dependencies

```bash
cd backend/api_service
pip install -r requirements.txt
```

The reporting module uses the same dependencies as the API service.

---

## Running the ASM Reporting Consumer

### Option 1: Direct Python (Development)

```bash
cd backend
python3 -m reporting.asm.main
```

### Option 2: Using Python Module

```bash
cd backend
python3 -c "from reporting.asm.main import main; import asyncio; asyncio.run(main())"
```

### Option 3: Background Process

```bash
cd backend
nohup python3 -m reporting.asm.main > logs/reporting.log 2>&1 &
```

---

## Environment Variables Required

```bash
# PostgreSQL
DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/cybersecurity

# Redis
REPORTING_REDIS_URL=redis://localhost:6379/1

# RabbitMQ
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest
```

---

## What the Consumer Does

- **Listens to**: `report.asm` queue in RabbitMQ
- **Processes**: Domain ASM events
- **Uses**: Separate Redis (DB 1) and PostgreSQL database
- **Logs**: All processing events to stdout/stderr

---

## Monitoring

```bash
# View logs
tail -f logs/reporting.log

# Check process
ps aux | grep "reporting.asm.main"

# Kill process
pkill -f "reporting.asm.main"
```

---

## Structure

```
reporting/
├── __init__.py
├── database.py          # PostgreSQL connection
├── redis_client.py      # Redis connection (DB 1)
├── queue.py             # RabbitMQ connection
├── asm/
│   ├── __init__.py
│   ├── main.py          # Consumer entry point
│   ├── repository.py    # Data access
│   └── assets/
│       ├── domain.py    # Domain processing
```

---

## Troubleshooting

### Consumer not starting

1. Check RabbitMQ is running: `rabbitmq-plugins enable rabbitmq_management`
2. Check PostgreSQL is running: `psql -U postgres`
3. Check Redis is running: `redis-cli ping`
4. Check imports are correct in `asm/main.py`

### Connection refused errors

Make sure all services are running on correct ports:
- PostgreSQL: 5432
- Redis: 6379
- RabbitMQ: 5672

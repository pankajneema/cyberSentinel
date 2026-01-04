# Connections & Integrations Guide

## Structure

```
api-service/
├── config/
│   └── settings.py      # All configuration from env
├── utils/
│   ├── database.py     # PostgreSQL connection
│   ├── redis_client.py # Redis connection
│   ├── queue.py        # RabbitMQ connection
│   ├── clickhouse_client.py # ClickHouse connection
│   └── models.py       # SQLAlchemy models
```

## Usage

### PostgreSQL (Database)

```python
from utils import get_db
from fastapi import Depends
from sqlalchemy.orm import Session

@router.get("/users")
async def get_users(db: Session = Depends(get_db)):
    # Use database
    users = db.query(User).all()
    return users
```

### Redis (Cache)

```python
from utils import get_redis

redis = get_redis()
if redis:
    redis.set("key", "value", ex=3600)
    value = redis.get("key")
```

### RabbitMQ (Queue)

```python
from utils import publish_message

# Publish job to queue
publish_message("asm-jobs", {
    "job_id": "123",
    "target": "example.com"
})
```

### ClickHouse (Analytics)

```python
from utils import get_clickhouse

clickhouse = get_clickhouse()
if clickhouse:
    result = clickhouse.execute("SELECT * FROM events")
```

## Configuration

All settings in `config/settings.py` from environment variables:

- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `RABBITMQ_URL` - RabbitMQ connection
- `CLICKHOUSE_URL` - ClickHouse connection

## Notes

- All connections are optional - app works even if services are down
- Connections are singleton (reused across requests)
- Auto-initialized on startup
- Auto-closed on shutdown



# API Service

## Structure

```
api-service/
├── config/              # Configuration
│   └── settings.py     # All settings from env
├── utils/              # Utilities & Connections
│   ├── database.py    # PostgreSQL connection
│   ├── redis_client.py # Redis connection
│   ├── queue.py        # RabbitMQ connection
│   ├── clickhouse_client.py # ClickHouse connection
│   └── models.py       # SQLAlchemy models
├── routes/             # API Routes
│   ├── auth.py
│   ├── users.py
│   └── ...
└── main.py            # FastAPI app
```

## Configuration

All configuration from environment variables via `config/settings.py`:

- Database: `DATABASE_URL`
- Redis: `REDIS_URL`
- RabbitMQ: `RABBITMQ_URL`
- ClickHouse: `CLICKHOUSE_URL`
- JWT: `SECRET_KEY`, `JWT_SECRET`

## Connections

All connections are managed in `utils/`:

- **PostgreSQL**: `utils.database.get_db()` - Returns database session
- **Redis**: `utils.redis_client.get_redis()` - Returns Redis client
- **RabbitMQ**: `utils.queue.get_queue_connection()` - Returns queue connection
- **ClickHouse**: `utils.clickhouse_client.get_clickhouse()` - Returns ClickHouse client

## Usage in Routes

```python
from utils import get_db, get_redis, publish_message
from fastapi import Depends
from sqlalchemy.orm import Session

@router.get("/example")
async def example(db: Session = Depends(get_db)):
    # Use PostgreSQL
    users = db.query(User).all()
    
    # Use Redis
    redis = get_redis()
    if redis:
        redis.set("key", "value")
    
    # Publish to queue
    publish_message("asm-jobs", {"job_id": "123"})
    
    return users
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```


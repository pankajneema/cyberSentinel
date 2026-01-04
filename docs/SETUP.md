# CyberSentinel Setup Guide

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- Docker and Docker Compose
- PostgreSQL 15+ (or use Docker)
- Redis (or use Docker)
- ClickHouse (or use Docker)

## Local Development Setup

### 1. Clone and Install Dependencies

```bash
# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../backend/api-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Start Infrastructure Services

```bash
# From project root
docker-compose up -d postgres redis clickhouse
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379
- ClickHouse on ports 8123 and 9000

### 3. Configure Environment Variables

Create `.env.local` in the frontend directory:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Create `.env` files in each backend service directory with database URLs and secrets.

### 4. Start Backend API Service

```bash
# API Service (all routes in one service)
cd backend/api-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Or use Docker Compose:

```bash
docker-compose up
```

### 5. Start Frontend

```bash
cd frontend
npm run dev
```

Visit http://localhost:3000

## Database Setup

### PostgreSQL

```sql
CREATE DATABASE cybersentinel;
```

Run migrations (when available):
```bash
cd backend/api-service
alembic upgrade head
```

### ClickHouse

ClickHouse is automatically initialized via Docker. For manual setup, see [ClickHouse documentation](https://clickhouse.com/docs).

## Testing

### Frontend Tests

```bash
cd frontend
npm test
```

### Backend Tests

```bash
cd backend/api-service
pytest
```

## Production Deployment

### Using Kubernetes

1. Build Docker images:
```bash
docker build -t cybersentinel/frontend:latest ./frontend
docker build -t cybersentinel/api-service:latest ./backend/api-service
```

2. Apply Kubernetes manifests:
```bash
kubectl apply -f infrastructure/kubernetes/
```

### Using Terraform

1. Configure AWS credentials
2. Update `variables.tf` with your values
3. Initialize and apply:
```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

## Troubleshooting

### Port Already in Use

If a port is already in use, either:
- Stop the conflicting service
- Change the port in the service configuration

### Database Connection Issues

- Verify PostgreSQL is running: `docker ps`
- Check connection string in `.env` files
- Ensure database exists: `psql -U postgres -c "SELECT 1"`

### CORS Errors

Ensure backend services have CORS middleware configured with the correct frontend URL.

## Next Steps

- Set up CI/CD pipelines
- Configure monitoring and logging
- Set up SSL certificates
- Configure backup strategies
- Review security settings


# How to Run CyberSentinel

## Quick Fix for "no configuration file provided" Error

If you're getting this error, try these solutions:

### Solution 1: Use `compose.yaml` instead

Docker Compose v2 prefers `compose.yaml` over `docker-compose.yml`. I've created both files for you.

```bash
# Try this:
docker compose up -d
```

### Solution 2: Specify the file explicitly

```bash
docker compose -f docker-compose.yml up -d
```

### Solution 3: Use the start script

```bash
./start.sh
```

## Step-by-Step Instructions

### 1. Start Infrastructure Services

```bash
# Make sure you're in the project root
cd /pnkj/CyberCurious

# Start services (try one of these):
docker compose up -d postgres redis clickhouse
# OR
docker compose -f docker-compose.yml up -d postgres redis clickhouse
# OR if you have docker-compose (v1):
docker-compose up -d postgres redis clickhouse
```

### 2. Install Frontend Dependencies (First Time Only)

```bash
cd frontend
npm install
```

### 3. Start Frontend

```bash
# Still in frontend directory
npm run dev
```

Visit: **http://localhost:3000**

### 4. Start Backend (Optional - for API testing)

```bash
# From project root, in a new terminal
docker compose up auth-service
# OR
docker compose -f docker-compose.yml up auth-service
```

API Docs: **http://localhost:8000/docs**

## Verify Everything is Running

```bash
# Check Docker containers
docker ps

# Check if services are responding
curl http://localhost:8000/  # Should return JSON
```

## Common Issues

### Issue: "no configuration file provided"

**Fix:** Make sure you're in the project root directory:
```bash
pwd  # Should show /pnkj/CyberCurious
ls docker-compose.yml  # Should show the file
```

### Issue: Docker Compose not found

**Fix:** Install Docker Compose or use Docker Desktop which includes it.

### Issue: Port already in use

**Fix:** Stop the conflicting service or change ports in docker-compose.yml

## Alternative: Run Without Docker

If Docker is causing issues, you can run the frontend standalone:

```bash
cd frontend
npm install
npm run dev
```

The frontend will work (though API calls will fail until backend is running).


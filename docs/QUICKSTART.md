# Quick Start Guide - CyberSentinel

## 🚀 Quick Start (Recommended - Using Docker)

### Step 1: Start Infrastructure Services

**For Docker Compose v2 (newer versions):**
```bash
# From project root
docker compose up -d postgres redis clickhouse
```

**For Docker Compose v1 (older versions):**
```bash
docker-compose up -d postgres redis clickhouse
```

This starts:
- ✅ PostgreSQL (port 5432)
- ✅ Redis (port 6379)  
- ✅ ClickHouse (ports 8123, 9000)

Wait ~10 seconds for services to be ready.

### Step 2: Install Frontend Dependencies

```bash
cd frontend
npm install
```

### Step 3: Start Frontend

```bash
# Still in frontend directory
npm run dev
```

Frontend will be available at: **http://localhost:3000**

### Step 4: Start Backend Services (Choose one option)

#### Option A: Using Docker Compose (Easiest)

**Docker Compose v2:**
```bash
# From project root
docker compose up auth-service
```

**Docker Compose v1:**
```bash
docker-compose up auth-service
```

This starts the Auth Service on port 8000.

#### Option B: Manual Python Setup (For Development)

```bash
# Terminal 1 - Auth Service
cd backend/auth-service
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2 - ASM Service (optional)
cd backend/asm-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001

# Terminal 3 - VS Service (optional)
cd backend/vs-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8002
```

## 📋 Prerequisites Checklist

Before running, ensure you have:

- [ ] **Node.js 18+** - Check: `node --version`
- [ ] **npm** - Check: `npm --version`
- [ ] **Docker & Docker Compose** - Check: `docker compose version` or `docker-compose --version`
- [ ] **Python 3.11+** (if running backend manually) - Check: `python --version`

## 🎯 What You'll See

### Frontend (http://localhost:3000)
- Landing page with hero, features, testimonials
- Sign up / Login pages
- Dashboard (after login)
- ASM workspace
- Vulnerability Scanning workspace

### Backend APIs
- Auth Service: http://localhost:8000/docs (Swagger UI)
- ASM Service: http://localhost:8001/docs
- VS Service: http://localhost:8002/docs

## 🔧 Troubleshooting

### "no configuration file provided: not found"

This error means Docker Compose can't find the `docker-compose.yml` file. Solutions:

1. **Make sure you're in the project root directory:**
   ```bash
   cd /pnkj/CyberCurious
   ls docker-compose.yml  # Should show the file
   ```

2. **Use the correct command for your Docker Compose version:**
   ```bash
   # Try Docker Compose v2 (newer)
   docker compose up -d
   
   # Or Docker Compose v1 (older)
   docker-compose up -d
   ```

3. **Specify the file explicitly:**
   ```bash
   docker compose -f docker-compose.yml up -d
   ```

### Port Already in Use

If port 3000, 8000, 5432, etc. are already in use:

```bash
# Find what's using the port (Linux/Mac)
lsof -i :3000
# Kill the process or change the port in config

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Docker Issues

```bash
# Check if Docker is running
docker ps

# Restart Docker services
docker compose down  # or docker-compose down
docker compose up -d  # or docker-compose up -d

# View logs
docker compose logs -f  # or docker-compose logs -f
```

### Frontend Build Errors

```bash
# Clear cache and reinstall
cd frontend
rm -rf node_modules .next
npm install
npm run dev
```

### Backend Connection Errors

1. Ensure PostgreSQL is running: `docker ps | grep postgres`
2. Check database connection: `docker exec -it cybersentinel-postgres psql -U postgres -d cybersentinel -c "SELECT 1;"`
3. Verify environment variables in backend services

### Module Not Found Errors

```bash
# Reinstall dependencies
cd frontend && npm install
cd ../backend/auth-service && pip install -r requirements.txt
```

## 🧪 Test the Setup

1. **Visit Frontend**: http://localhost:3000
2. **Check API**: http://localhost:8000/docs
3. **Try Signup**: Go to http://localhost:3000/signup
4. **View Dashboard**: After signup/login, go to http://localhost:3000/app/dashboard

## 📝 Environment Variables

### Frontend
Create `frontend/.env.local`:
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

### Backend
The docker-compose.yml already sets these, but for manual setup, create `.env` files in each service directory.

## 🎉 You're Ready!

Once everything is running:
- Frontend: http://localhost:3000
- API Docs: http://localhost:8000/docs
- Database: localhost:5432 (postgres/postgres)

Happy coding! 🚀

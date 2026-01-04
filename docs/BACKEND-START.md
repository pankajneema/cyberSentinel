# Backend API Service - Start Commands

## Quick Start

### API Service (Port 8000) - Main Service

```bash
cd backend/api-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**API Docs:** http://localhost:8000/docs

---

## All Routes Available

All routes are directly available on API Service (port 8000):

- **Auth**: `/api/v1/auth/*`
- **Users**: `/api/v1/users/*`
- **Profile**: `/api/v1/profile/*`
- **Accounts**: `/api/v1/accounts/*`
- **Billing**: `/api/v1/billing/*`
- **Services**: `/api/v1/services/*`
- **ASM**: `/api/v1/asm/*`
- **VS**: `/api/v1/scans/*`
- **Settings**: `/api/v1/settings/*`
- **Activity**: `/api/v1/activity`, `/api/v1/audit-logs`

---

## Background Workers (Optional)

```bash
# ASM Worker
cd backend/workers
python3 asm_worker.py

# VS Worker
python3 vs_worker.py
```

---

## Environment Variables

Create `.env` file in `backend/api-service/`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cybersentinel
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-here
JWT_SECRET=your-jwt-secret-here
```

---

## Frontend Connection

Frontend connects directly to API Service:

```bash
# In frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

No API Gateway needed - direct connection is faster! 🚀

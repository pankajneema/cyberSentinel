# CyberSentinel Backend

## Structure

```
backend/
├── api-service/          # Main API Service - All routes & business logic
│   ├── routes/           # Organized route files
│   │   ├── auth.py
│   │   ├── users.py
│   │   ├── profile.py
│   │   ├── accounts.py
│   │   ├── billing.py
│   │   ├── services.py
│   │   ├── asm.py
│   │   ├── vs.py
│   │   ├── settings.py
│   │   └── activity.py
│   ├── main.py           # Main app with all routes registered
│   ├── Dockerfile
│   └── requirements.txt
└── workers/              # Background workers (no API/UI)
    ├── asm_worker.py
    └── vs_worker.py
```

## Quick Start

### API Service (Port 8000) - Direct Access

```bash
cd api-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**API Docs:** http://localhost:8000/docs

### Workers (Background - Optional)

```bash
cd workers
python3 asm_worker.py    # Terminal 1
python3 vs_worker.py     # Terminal 2
```

## API Endpoints

All endpoints available directly: http://localhost:8000/docs

- Auth: `/api/v1/auth/*`
- Users: `/api/v1/users/*`
- Profile: `/api/v1/profile/*`
- Accounts: `/api/v1/accounts/*`
- Billing: `/api/v1/billing/*`
- Services: `/api/v1/services/*`
- ASM: `/api/v1/asm/*`
- VS: `/api/v1/scans/*`
- Settings: `/api/v1/settings/*`
- Activity: `/api/v1/activity`, `/api/v1/audit-logs`

## Frontend Connection

Frontend connects directly to API Service (no gateway needed):

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Direct connection = Faster performance! ⚡

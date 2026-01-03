# CyberSentinel API Routes

## Base URL
- **API Service**: `http://localhost:8000` (Direct access - no gateway needed!)

---

## 🔐 Authentication Routes

### POST `/api/v1/auth/signup`
User signup
```json
{
  "company_name": "Acme Corp",
  "full_name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123",
  "role": "admin",
  "country": "US"
}
```

### POST `/api/v1/auth/login`
User login
```json
{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

### POST `/api/v1/auth/logout`
User logout

### POST `/api/v1/auth/magic-link`
Request magic link for passwordless login

### POST `/api/v1/auth/refresh`
Refresh access token

### POST `/api/v1/auth/forgot-password`
Request password reset

### POST `/api/v1/auth/reset-password`
Reset password with token

### GET `/api/v1/auth/verify`
Verify JWT token

---

## 👤 User Routes

### GET `/api/v1/users/me`
Get current authenticated user

### GET `/api/v1/users`
List all users (admin only)
- Query: `?skip=0&limit=100`

### GET `/api/v1/users/{user_id}`
Get user by ID

### PUT `/api/v1/users/{user_id}`
Update user

### DELETE `/api/v1/users/{user_id}`
Delete user

---

## 📝 Profile Routes

### GET `/api/v1/profile`
Get current user profile

### PUT `/api/v1/profile`
Update user profile
```json
{
  "full_name": "John Doe",
  "phone": "+1234567890",
  "bio": "Security Engineer",
  "country": "US",
  "timezone": "America/New_York"
}
```

### PATCH `/api/v1/profile/avatar`
Update user avatar
```json
{
  "avatar_url": "https://example.com/avatar.jpg"
}
```

### POST `/api/v1/profile/change-password`
Change user password
```json
{
  "current_password": "OldPass123",
  "new_password": "NewPass123"
}
```

---

## 🏢 Account Routes

### GET `/api/v1/accounts/{account_id}`
Get account information

### PUT `/api/v1/accounts/{account_id}`
Update account settings

### GET `/api/v1/accounts/{account_id}/members`
List account members

### POST `/api/v1/accounts/{account_id}/invite`
Invite member to account
```json
{
  "email": "newuser@example.com",
  "role": "analyst"
}
```

### DELETE `/api/v1/accounts/{account_id}/members/{member_id}`
Remove member from account

---

## 💳 Billing Routes

### GET `/api/v1/billing/plan`
Get current subscription plan

### POST `/api/v1/billing/subscribe`
Create or update subscription
```json
{
  "company_id": "uuid",
  "plan": "pro",
  "billing_period": "monthly"
}
```

### GET `/api/v1/billing/invoices`
List all invoices

### GET `/api/v1/billing/invoices/{invoice_id}`
Get invoice by ID

### POST `/api/v1/billing/payment-method`
Add payment method

### DELETE `/api/v1/billing/payment-method/{method_id}`
Remove payment method

### POST `/api/v1/billing/upgrade`
Upgrade subscription plan

### POST `/api/v1/billing/cancel`
Cancel subscription

---

## 🛠️ Services Routes

### GET `/api/v1/services`
List all available services

### GET `/api/v1/services/{service_id}`
Get service details

### POST `/api/v1/services/{service_id}/purchase`
Purchase a service

### POST `/api/v1/services/{service_id}/activate`
Activate a service

### POST `/api/v1/services/{service_id}/deactivate`
Deactivate a service

---

## 🔍 ASM Routes

### POST `/api/v1/asm/discover`
Start ASM discovery
```json
{
  "target": "example.com",
  "scan_type": "external"
}
```

### GET `/api/v1/asm/jobs/{job_id}`
Get discovery job status

### GET `/api/v1/asm/assets`
List discovered assets
- Query: `?skip=0&limit=100`

### GET `/api/v1/asm/assets/{asset_id}`
Get asset details

### DELETE `/api/v1/asm/assets/{asset_id}`
Delete asset

### GET `/api/v1/asm/dashboard`
High-level ASM overview metrics used by the ASM UI.

```json
{
  "attack_surface_score": 62,
  "critical_count": 10,
  "high_count": 25,
  "resolved_count": 156,
  "total_assets": 1247,
  "last_scan": "2024-01-20T14:30:00Z"
}
```

---

## 🛡️ Vulnerability Scanning Routes

### POST `/api/v1/scans`
Create vulnerability scan
```json
{
  "name": "External Scan - Production",
  "target": "api.example.com",
  "scan_type": "external",
  "frequency": "weekly"
}
```

### GET `/api/v1/scans`
List all scans
- Query: `?skip=0&limit=100`

### GET `/api/v1/scans/{scan_id}`
Get scan results

### POST `/api/v1/scans/{scan_id}/retest`
Retest a scan

### DELETE `/api/v1/scans/{scan_id}`
Delete scan

---

## 📦 Asset Inventory Routes

### GET `/api/v1/assets`
Central asset inventory used by Assets, ASM, and VS modules.

- Query (optional):
  - `q`: search by name
  - `type`: `domain|ip|cloud|repo|saas|user`
  - `exposure`: `public|internal`
  - `page`, `page_size`

```json
{
  "items": [
    {
      "id": "1",
      "name": "api.company.com",
      "type": "domain",
      "exposure": "public",
      "risk_score": 78,
      "tags": ["production", "api"],
      "last_seen": "2024-01-20T14:30:00Z",
      "status": "active"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 50
}
```

### POST `/api/v1/assets`
Create a new asset in the central inventory.

```json
{
  "name": "new.company.com",
  "type": "domain",
  "exposure": "public",
  "tags": ["production"]
}
```

### GET `/api/v1/assets/{asset_id}`
Get asset details.

### PATCH `/api/v1/assets/{asset_id}`
Update asset fields (name, exposure, tags, risk_score, status).

### DELETE `/api/v1/assets/{asset_id}`
Delete asset from inventory.

---

## ✅ Task & Remediation Routes

### GET `/api/v1/tasks`
List remediation/operational tasks used by the Team module.

- Query (optional):
  - `q`: search by title or assignee
  - `status`: `pending|in_progress|completed|overdue`
  - `priority`: `critical|high|medium|low`
  - `page`, `page_size`

### POST `/api/v1/tasks`
Create a new task (e.g. from Team page or from a VS finding).

```json
{
  "title": "Patch CVE-2024-1234 on web server",
  "description": "Critical vulnerability requires immediate attention",
  "priority": "critical",
  "assignee_id": "user-id",
  "assignee_name": "John Smith",
  "due_date": "2024-01-22T18:00:00Z",
  "asset_name": "api.company.com"
}
```

### GET `/api/v1/tasks/{task_id}`
Get full task details including messages.

### PATCH `/api/v1/tasks/{task_id}`
Update task fields (status, assignee, title, etc.).

### DELETE `/api/v1/tasks/{task_id}`
Delete a task.

### GET `/api/v1/tasks/{task_id}/messages`
List messages associated with a task.

### POST `/api/v1/tasks/{task_id}/messages`
Append a new message (internal, Slack, Jira, or email) to a task.

```json
{
  "message": "Working on the fix now",
  "platform": "slack"
}
```

---

## 🐞 VS Module (Dashboard) Routes

### GET `/api/v1/vs/dashboard`
Aggregated vulnerability scanning metrics used by the VS dashboard UI.

```json
{
  "total_vulnerabilities": 191,
  "critical": 12,
  "high": 34,
  "medium": 89,
  "low": 56,
  "avg_mttr_days": 4.2,
  "scan_coverage": 87
}
```

---

## ⚙️ Settings Routes

### GET `/api/v1/settings`
Get user settings

### PUT `/api/v1/settings`
Update user settings
```json
{
  "notifications": {
    "email": true,
    "slack": false,
    "push": true
  },
  "preferences": {
    "theme": "dark",
    "language": "en",
    "timezone": "UTC"
  }
}
```

---

## 📊 Activity & Audit Routes

### GET `/api/v1/activity`
Get user activity log
- Query: `?skip=0&limit=50`

### GET `/api/v1/audit-logs`
Get audit logs (admin only)
- Query: `?skip=0&limit=100`

---

## 🔑 Authentication

Most endpoints require authentication. Include JWT token in header:

```
Authorization: Bearer <your-token>
```

Get token from `/api/v1/auth/login` endpoint.

---

## 📝 Notes

- All routes are available directly on **API Service** at port **8000**
- No API Gateway - direct connection for better performance
- All responses are in JSON format
- Error responses follow RFC 7807 Problem Details format


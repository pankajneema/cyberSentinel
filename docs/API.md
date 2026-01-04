# CyberSentinel API Documentation

## Base URL

- Development: `http://localhost:8000/api/v1`
- Production: `https://api.cybersentinel.com/api/v1`

## Authentication

Most endpoints require authentication via JWT token. Include the token in the Authorization header:

```
Authorization: Bearer <your-token>
```

## Endpoints

### Authentication

#### POST `/auth/signup`
Create a new user account.

**Request Body:**
```json
{
  "company_name": "Acme Corp",
  "full_name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePassword123",
  "role": "admin",
  "country": "US"
}
```

**Response:**
```json
{
  "message": "User created successfully",
  "user_id": "uuid",
  "company_id": "uuid"
}
```

#### POST `/auth/login`
Authenticate and receive access token.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePassword123"
}
```

**Response:**
```json
{
  "access_token": "jwt-token",
  "token_type": "bearer"
}
```

### ASM (Attack Surface Management)

#### POST `/asm/discover`
Start a new asset discovery job.

**Request Body:**
```json
{
  "target": "example.com",
  "scan_type": "external"
}
```

**Response:**
```json
{
  "job_id": "uuid",
  "status": "running"
}
```

#### GET `/asm/jobs/{job_id}`
Get discovery job status.

**Response:**
```json
{
  "job_id": "uuid",
  "status": "completed",
  "progress": 100,
  "created_at": "2024-01-14T10:00:00Z"
}
```

#### GET `/asm/assets`
List discovered assets.

**Query Parameters:**
- `skip` (int): Number of records to skip
- `limit` (int): Maximum number of records to return

**Response:**
```json
{
  "assets": [
    {
      "id": "uuid",
      "type": "domain",
      "identifier": "api.example.com",
      "first_seen": "2024-01-01T00:00:00Z",
      "last_seen": "2024-01-14T00:00:00Z",
      "risk_score": 95,
      "tags": ["production", "api"]
    }
  ],
  "total": 100
}
```

### Vulnerability Scanning

#### POST `/scans`
Create a new vulnerability scan.

**Request Body:**
```json
{
  "name": "External Scan - Production",
  "target": "api.example.com",
  "scan_type": "external",
  "frequency": "weekly"
}
```

**Response:**
```json
{
  "scan_id": "uuid",
  "status": "running"
}
```

#### GET `/scans/{scan_id}`
Get scan results.

**Response:**
```json
{
  "id": "uuid",
  "scan_type": "external",
  "target": "api.example.com",
  "status": "completed",
  "results": [
    {
      "cve": "CVE-2024-0001",
      "severity": "critical",
      "exploitability_score": 9.8,
      "description": "Remote code execution vulnerability",
      "remediation": "Update to version 2.0.1"
    }
  ],
  "created_at": "2024-01-14T10:00:00Z"
}
```

### Billing

#### GET `/billing/plan`
Get current subscription plan.

**Query Parameters:**
- `company_id` (string): Company ID

**Response:**
```json
{
  "plan": "pro",
  "status": "active",
  "billing_period": "monthly"
}
```

## Error Responses

All errors follow RFC 7807 Problem Details format:

```json
{
  "type": "https://cybersentinel.com/errors/validation-error",
  "title": "Validation Error",
  "status": 400,
  "detail": "Invalid email address",
  "instance": "/api/v1/auth/signup"
}
```

## Rate Limiting

- Free tier: 100 requests/hour
- Pro tier: 1,000 requests/hour
- Enterprise: Unlimited

Rate limit headers:
- `X-RateLimit-Limit`: Maximum requests per hour
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)


"""Pydantic schemas for the VS (Vulnerability Scanning) API."""
from __future__ import annotations

from typing import Optional, Any
from pydantic import BaseModel, Field


# --- profiles ---
class VsProfileCreate(BaseModel):
    name: str
    intensity: str = "standard"          # light|standard|deep
    engines: list[str] = Field(default_factory=lambda: ["nuclei"])
    authenticated: bool = False
    credential_id: Optional[str] = None
    safe_mode: bool = True
    max_requests_per_sec: int = 20
    scan_window: Optional[dict] = None
    web_scan: bool = True


class VsProfileResponse(BaseModel):
    id: str
    name: str
    intensity: str
    engines: list[str]
    authenticated: bool
    credential_id: Optional[str] = None
    safe_mode: bool
    max_requests_per_sec: int
    scan_window: Optional[dict] = None
    web_scan: bool
    created_at: Optional[str] = None


# --- scans ---
class VsScanCreate(BaseModel):
    name: str
    profile_id: str
    asset_ids: list[str]
    schedule_type: str = "QUICK"         # QUICK|INTERVAL|CRON
    schedule_value: Optional[str] = None


class VsScanUpdate(BaseModel):
    name: Optional[str] = None
    profile_id: Optional[str] = None
    asset_ids: Optional[list[str]] = None
    schedule_type: Optional[str] = None
    schedule_value: Optional[str] = None


class VsScanResponse(BaseModel):
    id: str
    name: str
    profile_id: str
    asset_ids: list[str]
    schedule_type: str
    schedule_value: Optional[str] = None
    status: str
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    created_at: Optional[str] = None


# --- findings ---
class VsFindingResponse(BaseModel):
    id: str
    asset_id: str
    scan_run_id: Optional[str] = None
    source_engine: str
    plugin_id: Optional[str] = None
    cve_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    location: Optional[dict] = None
    evidence: Optional[str] = None
    confidence: str
    severity: str
    cvss_base: Optional[float] = None
    epss: Optional[float] = None
    kev: bool
    composite_risk: Optional[int] = None
    risk_factors: Optional[Any] = None
    status: str
    assigned_to: Optional[str] = None
    sla_due_at: Optional[str] = None
    first_detected_at: Optional[str] = None
    last_detected_at: Optional[str] = None


class VsFindingStatusUpdate(BaseModel):
    status: str                           # target lifecycle state
    justification: Optional[str] = None   # required for accepted_risk / false_positive


class VsFindingAssign(BaseModel):
    assigned_to: Optional[str] = None


# --- dashboard / cve ---
class VsDashboardResponse(BaseModel):
    total_vulnerabilities: int
    critical: int
    high: int
    medium: int
    low: int
    kev_count: int
    avg_mttr_days: float
    scan_coverage: int
    sla_breaches: int


class VsCredentialCreate(BaseModel):
    name: str
    cred_type: str                       # http_basic|http_form|ssh|bearer
    username: Optional[str] = None
    secret: str                          # write-only — encrypted at rest, never returned


class VsCredentialResponse(BaseModel):
    id: str
    name: str
    cred_type: str
    username: Optional[str] = None
    created_at: Optional[str] = None
    # NOTE: the secret is intentionally NEVER included in any response.


class VsCveResponse(BaseModel):
    cve_id: str
    cvss_v31: dict
    cvss_v40: dict
    epss: Optional[float] = None
    epss_percentile: Optional[float] = None
    kev: bool
    kev_date_added: Optional[str] = None
    kev_due_date: Optional[str] = None
    cwe_ids: Optional[list] = None
    affected_versions: Optional[list] = None
    references: Optional[list] = None
    published_at: Optional[str] = None
    modified_at: Optional[str] = None

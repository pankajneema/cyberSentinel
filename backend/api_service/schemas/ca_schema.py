# schemas/ca_schema.py
#
# Request/response schemas for the Compliance & Audit (CA) module.
# Conventions match schemas/vs_schema.py: Create / Update(all-Optional) /
# Response per entity, Literal unions for enum-like strings.

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

ControlStatus = Literal["satisfied", "partial", "gap", "not_applicable", "unknown"]
GapStatus = Literal["open", "in_progress", "resolved", "verified", "closed", "accepted_risk"]
EvidenceCollection = Literal["automated", "manual"]
EvidenceStatus = Literal["valid", "stale", "superseded", "revoked"]
Criticality = Literal["critical", "high", "medium", "low"]
AuditStatus = Literal["preparation", "fieldwork", "remediation", "complete"]
PolicyStatus = Literal["draft", "active", "archived", "template"]


# --------------------------------------------------------------------------
# Frameworks
# --------------------------------------------------------------------------
class FrameworkEnableRequest(BaseModel):
    target_date: Optional[datetime] = None


class FrameworkResponse(BaseModel):
    id: str
    key: str
    name: str
    version: str
    authority: Optional[str] = None
    region: Optional[str] = None
    description: Optional[str] = None
    is_reference: bool = False
    enabled: bool = False
    enablement: Optional[Dict[str, Any]] = None
    posture: Optional[Dict[str, Any]] = None   # counts + score, present when enabled
    control_count: int = 0


# --------------------------------------------------------------------------
# Controls
# --------------------------------------------------------------------------
class ApplicabilityRequest(BaseModel):
    not_applicable: bool
    justification: Optional[str] = None   # mandatory when not_applicable=True (route-enforced 400)
    scope: Optional[str] = None


# --------------------------------------------------------------------------
# Evidence
# --------------------------------------------------------------------------
class EvidenceRevokeRequest(BaseModel):
    justification: str = Field(min_length=3)


class ManualEvidenceMeta(BaseModel):
    check_id: Optional[str] = None
    summary: str = Field(min_length=3)
    valid_days: int = Field(default=180, ge=1, le=1095)


# --------------------------------------------------------------------------
# Gaps / remediation
# --------------------------------------------------------------------------
class GapTransitionRequest(BaseModel):
    status: GapStatus
    justification: Optional[str] = None


class GapAssignRequest(BaseModel):
    assigned_to: Optional[str] = None     # Supabase sub; None = unassign


# --------------------------------------------------------------------------
# Policies
# --------------------------------------------------------------------------
class PolicyCreate(BaseModel):
    title: str = Field(min_length=3)
    key: Optional[str] = None
    description: Optional[str] = None
    review_frequency_days: int = Field(default=365, ge=30, le=1095)
    from_template_id: Optional[str] = None


class PolicyUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[PolicyStatus] = None
    owner_user_id: Optional[str] = None
    review_frequency_days: Optional[int] = Field(default=None, ge=30, le=1095)


class PolicyVersionCreate(BaseModel):
    body_md: str = Field(min_length=10)


# --------------------------------------------------------------------------
# Audits & auditor access
# --------------------------------------------------------------------------
class AuditCreate(BaseModel):
    framework_id: str
    name: str = Field(min_length=3)
    audit_firm: Optional[str] = None
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    scope: Optional[Dict[str, Any]] = None    # {"control_ids": [...]} | {"categories": [...]}


class AuditUpdate(BaseModel):
    name: Optional[str] = None
    audit_firm: Optional[str] = None
    status: Optional[AuditStatus] = None
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    scope: Optional[Dict[str, Any]] = None


class AuditorGrantCreate(BaseModel):
    auditor_email: str
    expires_in_days: int = Field(default=30, ge=1, le=180)


class AuditorGrantCreated(BaseModel):
    grant: Dict[str, Any]
    token: str    # plaintext, returned exactly once


class AuditorFindingCreate(BaseModel):
    control_id: Optional[str] = None
    title: str = Field(min_length=3)
    description: Optional[str] = None
    severity: Optional[Criticality] = None


class AuditFindingUpdate(BaseModel):
    status: Optional[Literal["open", "responded", "resolved", "accepted"]] = None


class AttestationCreate(BaseModel):
    kind: Optional[str] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None


# --------------------------------------------------------------------------
# Posture
# --------------------------------------------------------------------------
class PostureCounts(BaseModel):
    satisfied: int
    partial: int
    gap: int
    unknown: int
    not_applicable: int
    applicable: int
    total: int


class FrameworkPosture(BaseModel):
    framework_id: str
    framework_key: str
    framework_name: str
    counts: PostureCounts
    score: Optional[float] = None   # floor((satisfied + 0.5*partial)/applicable*100); None if applicable=0
    computed_at: Optional[datetime] = None


class PaginatedResponse(BaseModel):
    items: List[Dict[str, Any]]
    total: int
    page: int
    page_size: int

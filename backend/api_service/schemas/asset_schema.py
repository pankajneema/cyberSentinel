from pydantic import BaseModel
from typing import List, Optional, Literal


# ---------------------------------------------------
# Asset Response
# ---------------------------------------------------
class AssetResponse(BaseModel):
    id: str
    name: str
    type: str
    exposure: str
    criticality: str = "normal"
    risk_score: Optional[int] = None      # None = never scored ("Unscanned")
    last_scored_at: Optional[str] = None
    tags: List[str]
    status: str
    last_seen: Optional[str]
    description: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]


# ---------------------------------------------------
# Asset List Response
# ---------------------------------------------------
class AssetListResponse(BaseModel):
    items: List[AssetResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------
# Asset Create Request
# ---------------------------------------------------
class AssetCreateRequest(BaseModel):
    name: str
    type: Literal["domain", "ip", "cloud", "repo", "saas", "user"]
    exposure: Literal["public", "internal"] = "internal"
    criticality: Literal["low", "normal", "high", "critical"] = "normal"
    tags: Optional[List[str]] = None
    description: Optional[str] = None


# ---------------------------------------------------
# Asset Update Request
# ---------------------------------------------------
class AssetUpdateRequest(BaseModel):
    name: Optional[str] = None
    exposure: Optional[Literal["public", "internal"]] = None
    criticality: Optional[Literal["low", "normal", "high", "critical"]] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    risk_score: Optional[int] = None
    description: Optional[str] = None


# ---------------------------------------------------
# Bulk import (CSV-driven)
# ---------------------------------------------------
class AssetImportRow(BaseModel):
    name: str
    type: Literal["domain", "ip", "cloud", "repo", "saas", "user"] = "domain"
    exposure: Literal["public", "internal"] = "internal"
    tags: Optional[List[str]] = None
    description: Optional[str] = None


class AssetImportRequest(BaseModel):
    assets: List[AssetImportRow]


class AssetImportResult(BaseModel):
    created: int
    skipped: int
    errors: List[str]


# ---------------------------------------------------
# Rescore (real exposure scoring from ASM data)
# ---------------------------------------------------
class ScoreFactorResponse(BaseModel):
    name: str
    points: float
    detail: str


class AssetRescoreResult(BaseModel):
    scored: bool                       # False => no ASM scan data matched this asset
    risk_score: Optional[int] = None
    severity: Optional[str] = None     # critical|high|medium|low|info
    factors: List[ScoreFactorResponse] = []
    matched_ips: List[str] = []
    message: Optional[str] = None

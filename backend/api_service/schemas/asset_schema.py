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
    risk_score: int
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
    tags: Optional[List[str]] = None
    description: Optional[str] = None


# ---------------------------------------------------
# Asset Update Request
# ---------------------------------------------------
class AssetUpdateRequest(BaseModel):
    name: Optional[str] = None
    exposure: Optional[Literal["public", "internal"]] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    risk_score: Optional[int] = None
    description: Optional[str] = None

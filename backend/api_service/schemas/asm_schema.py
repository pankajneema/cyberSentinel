from pydantic import BaseModel
from typing import List, Optional, Literal


# ---------------------------------------------------
# Asm Discovery Create Request
# ---------------------------------------------------
class AsmDiscoveryCreateRequest(BaseModel):
    name: str
    asset_type: Literal["domain", "cloud", "saas"]
    target_source: Literal["FROM_ASSET", "MANUAL_ENTRY"]
    asset_ids: Optional[List[str]] = None
    manual_targets: Optional[List[str]] = None

    intensity: Literal["LIGHT", "NORMAL", "DEEP"] = "NORMAL"

    schedule_type: Literal["QUICK", "INTERVAL", "CRON"] = "QUICK"
    schedule_value: Optional[str] = None


# ---------------------------------------------------
# Asm Discovery Update Request
# ---------------------------------------------------
class AsmDiscoveryUpdateRequest(BaseModel):
    name: Optional[str] = None
    intensity: Optional[Literal["LIGHT", "NORMAL", "DEEP"]] = None
    schedule_type: Optional[Literal["QUICK", "INTERVAL", "CRON"]] = None
    schedule_value: Optional[str] = None
    status: Optional[Literal["ACTIVE", "PAUSED"]] = None


# ---------------------------------------------------
# Asm Discovery Response
# ---------------------------------------------------
class AsmDiscoveryResponse(BaseModel):
    id: str
    name: str
    asset_type: str
    intensity: str

    schedule_type: str
    schedule_value: Optional[str]

    status: str
    last_run_at: Optional[str]
    next_run_at: Optional[str]

    created_at: Optional[str]
    updated_at: Optional[str]


# ---------------------------------------------------
# Asm Discovery List Response
# ---------------------------------------------------
class AsmDiscoveryListResponse(BaseModel):
    items: List[AsmDiscoveryResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------
# Asm Dashboard Response
# ---------------------------------------------------
class AsmDashboardResponse(BaseModel):
    attack_surface_score: int
    total_discoveries: int
    active_discoveries: int
    last_discovery_run: Optional[str]

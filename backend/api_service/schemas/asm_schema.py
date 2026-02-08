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
    status: Optional[Literal["RUNNING", "PAUSED", "FAILED", "COMPLETED"]] = None


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


# ---------------------------------------------------
# ASM Overview Response (dashboard overview)
# ---------------------------------------------------
class AsmOverviewResponse(BaseModel):
    attack_surface_index: int
    total_discoveries: int
    active_discoveries: int
    last_discovery_run: Optional[str]
    
    asset_counts: dict
    exposure_summary: dict
    exposure_breakdown: list
    exposure_trend: int = 0
    
    top_exposed_assets: Optional[list] = None
    recent_activity: Optional[list] = None


# ---------------------------------------------------
# Asm Discovery Run Response
# ---------------------------------------------------
class AsmDiscoveryRunResponse(BaseModel):
    id: str
    asm_discovery_id: str
    user_id: str
    triggered_by: str
    run_mode: str
    status: str
    started_at: Optional[str]
    completed_at: Optional[str]
    duration_seconds: Optional[int] = None
    error_message: Optional[str]
    summary: Optional[dict]
    created_at: Optional[str]


# ---------------------------------------------------
# Asm Discovery Run List Response
# ---------------------------------------------------
class AsmDiscoveryRunListResponse(BaseModel):
    items: List[AsmDiscoveryRunResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------
# Asm Subdomain Create Request
# ---------------------------------------------------
class AsmSubdomainCreateRequest(BaseModel):
    asm_discovery_id: str
    asset_id: str
    subdomain: str


# ---------------------------------------------------
# Asm Subdomain Response
# ---------------------------------------------------
class AsmSubdomainResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    subdomain: str
    status: Optional[str] = None  # active, inactive, archived
    resolved: Optional[bool] = None  # DNS resolution status: true=resolved, false=unresolved, null=not checked
    created_at: Optional[str]
    asset_name: Optional[str] = None  # Parent domain/asset name
    asset_type: Optional[str] = None  # Parent asset type


# ---------------------------------------------------
# Asm Subdomain List Response
# ---------------------------------------------------
class AsmSubdomainListResponse(BaseModel):
    items: List[AsmSubdomainResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------
# Asm IP Response (child of Subdomain)
# ---------------------------------------------------
class AsmIPResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    ip_address: str
    subdomain_id: Optional[str]  # Parent subdomain ID (hierarchy link)
    subdomain: Optional[str]  # Denormalized subdomain name
    status: str
    exposure_score: Optional[int] = None  # 0-100, null if not calculated
    exposure_level: str = "not_calculated"  # low, medium, high, not_calculated
    reachable: Optional[bool] = None  # HTTP/HTTPS reachable
    open_ports: Optional[int] = None
    created_at: Optional[str]


# ---------------------------------------------------
# Asm IP List Response
# ---------------------------------------------------
class AsmIPListResponse(BaseModel):
    items: List[AsmIPResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------
# Enhanced Subdomain Response with IP count
# ---------------------------------------------------
class AsmSubdomainWithIPsResponse(AsmSubdomainResponse):
    ip_count: int = 0  # Number of IPs associated with this subdomain
    status: Optional[str] = None  # Subdomain status


# ---------------------------------------------------
# ASM Extended Data Responses
# ---------------------------------------------------
class AsmPortResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    ip_address: str
    port: int
    protocol: Optional[str] = None
    status: Optional[str] = None
    service: Optional[str] = None
    banner: Optional[str] = None
    created_at: Optional[str]


class AsmServiceResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    ip_address: str
    port: int
    service_name: str
    version: Optional[str] = None
    product: Optional[str] = None
    created_at: Optional[str]


class AsmSSLCertResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    host: str
    port: int
    protocol: Optional[str] = None
    cipher: Optional[str] = None
    certificate_issuer: Optional[str] = None
    certificate_subject: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    created_at: Optional[str]


class AsmAPIEndpointResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    url: str
    method: Optional[str] = None
    status_code: Optional[int] = None
    endpoint_type: Optional[str] = None
    created_at: Optional[str]


class AsmCloudResourceResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    service: str
    resource_type: str
    resource_name: str
    access_status: Optional[str] = None
    region: Optional[str] = None
    created_at: Optional[str]


class AsmAdminEndpointResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    url: str
    status_code: Optional[int] = None
    endpoint_type: Optional[str] = None
    created_at: Optional[str]


class AsmBackupFileResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    file_url: str
    file_extension: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[str]


class AsmChangeResponse(BaseModel):
    id: str
    asm_discovery_id: str
    asset_id: str
    changes: Optional[list] = None
    message: Optional[str] = None
    created_at: Optional[str]


class AsmPortListResponse(BaseModel):
    items: List[AsmPortResponse]
    total: int
    page: int
    page_size: int


class AsmServiceListResponse(BaseModel):
    items: List[AsmServiceResponse]
    total: int
    page: int
    page_size: int


class AsmSSLCertListResponse(BaseModel):
    items: List[AsmSSLCertResponse]
    total: int
    page: int
    page_size: int


class AsmAPIEndpointListResponse(BaseModel):
    items: List[AsmAPIEndpointResponse]
    total: int
    page: int
    page_size: int


class AsmCloudResourceListResponse(BaseModel):
    items: List[AsmCloudResourceResponse]
    total: int
    page: int
    page_size: int


class AsmAdminEndpointListResponse(BaseModel):
    items: List[AsmAdminEndpointResponse]
    total: int
    page: int
    page_size: int


class AsmBackupFileListResponse(BaseModel):
    items: List[AsmBackupFileResponse]
    total: int
    page: int
    page_size: int


class AsmChangeListResponse(BaseModel):
    items: List[AsmChangeResponse]
    total: int
    page: int
    page_size: int

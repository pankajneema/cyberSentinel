# services.py — module catalog.
#
# This is the product module catalog (which CyberSentinel modules exist and their
# availability). It is intentionally STATIC config, not user data — but it must be
# HONEST: only modules that actually work are marked "available". Everything else is
# "coming-soon". No fake purchase/activation success is returned for capabilities that
# are not backed by a real entitlements/billing system.
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/api/v1/services", tags=["Services"])

from utils.auth import CurrentUser, get_current_user


def _require_admin(current_user: CurrentUser) -> CurrentUser:
    if current_user.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


class ServiceInfo(BaseModel):
    id: str
    name: str
    description: str
    status: str  # available | coming-soon
    price: Optional[float] = None


# Honest, immutable catalog. Only ASM is production; the rest are on the roadmap.
_SERVICE_CATALOG: tuple[ServiceInfo, ...] = (
    ServiceInfo(
        id="asm",
        name="Attack Surface Management",
        description="Continuously discover and manage all your external assets",
        status="available",
        price=None,
    ),
    ServiceInfo(
        id="vs",
        name="Vulnerability Scanning",
        description="High-fidelity vulnerability scanning with prioritization",
        status="coming-soon",
        price=None,
    ),
    ServiceInfo(
        id="bas",
        name="Breach & Attack Simulation",
        description="Automated adversary emulation",
        status="coming-soon",
        price=None,
    ),
    ServiceInfo(
        id="threat-intel",
        name="Threat Intelligence",
        description="Real-time threat feeds and IOC correlation",
        status="coming-soon",
        price=None,
    ),
    ServiceInfo(
        id="ir",
        name="Incident Response Orchestration",
        description="Automated playbooks and response workflows",
        status="coming-soon",
        price=None,
    ),
    ServiceInfo(
        id="compliance",
        name="Compliance & Audit",
        description="Automated compliance checks and audit reports",
        status="coming-soon",
        price=None,
    ),
)

_CATALOG_BY_ID = {s.id: s for s in _SERVICE_CATALOG}


@router.get("", response_model=List[ServiceInfo])
async def list_services(
    current_user: CurrentUser = Depends(get_current_user),
):
    _require_admin(current_user)
    return list(_SERVICE_CATALOG)


@router.get("/{service_id}", response_model=ServiceInfo)
async def get_service(
    service_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    _require_admin(current_user)
    service = _CATALOG_BY_ID.get(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return service


def _lifecycle_unavailable(service_id: str):
    """Purchase / activate / deactivate are not backed by a real entitlements or
    billing system yet. Return an honest 501 instead of faking success."""
    service = _CATALOG_BY_ID.get(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=(
            "Module purchase/activation is not available yet. "
            f"'{service.name}' is currently '{service.status}'."
        ),
    )


@router.post("/{service_id}/purchase")
async def purchase_service(
    service_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    _require_admin(current_user)
    _lifecycle_unavailable(service_id)


@router.post("/{service_id}/activate")
async def activate_service(
    service_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    _require_admin(current_user)
    _lifecycle_unavailable(service_id)


@router.post("/{service_id}/deactivate")
async def deactivate_service(
    service_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    _require_admin(current_user)
    _lifecycle_unavailable(service_id)

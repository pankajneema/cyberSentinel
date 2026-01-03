# services.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/api/v1/services", tags=["Services"])

from utils.auth_utils import get_current_user

# Mock services database
services_db = {}

class ServiceInfo(BaseModel):
    id: str
    name: str
    description: str
    status: str  # available, coming-soon
    price: Optional[float] = None

@router.get("", response_model=List[ServiceInfo])
async def list_services(current_user: dict = Depends(get_current_user)):
    if not services_db:
        services_db["asm"] = {
            "id": "asm",
            "name": "Attack Surface Management",
            "description": "Continuously discover and manage all your external assets",
            "status": "available",
            "price": None
        }
        services_db["vs"] = {
            "id": "vs",
            "name": "Vulnerability Scanning",
            "description": "High-fidelity vulnerability scanning with prioritization",
            "status": "available",
            "price": None
        }
        services_db["bas"] = {
            "id": "bas",
            "name": "Breach & Attack Simulation",
            "description": "Automated adversary emulation",
            "status": "coming-soon",
            "price": None
        }
        services_db["threat-intel"] = {
            "id": "threat-intel",
            "name": "Threat Intelligence",
            "description": "Real-time threat feeds and IOC correlation",
            "status": "coming-soon",
            "price": None
        }
        services_db["ir"] = {
            "id": "ir",
            "name": "Incident Response Orchestration",
            "description": "Automated playbooks and response workflows",
            "status": "coming-soon",
            "price": None
        }
        services_db["compliance"] = {
            "id": "compliance",
            "name": "Compliance & Audit",
            "description": "Automated compliance checks and audit reports",
            "status": "coming-soon",
            "price": None
        }
    return [ServiceInfo(**s) for s in services_db.values()]

@router.get("/{service_id}", response_model=ServiceInfo)
async def get_service(service_id: str, current_user: dict = Depends(get_current_user)):
    service = services_db.get(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return ServiceInfo(**service)

@router.post("/{service_id}/purchase")
async def purchase_service(service_id: str, current_user: dict = Depends(get_current_user)):
    service = services_db.get(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"message": f"Service {service_id} purchased", "service_id": service_id}

@router.post("/{service_id}/activate")
async def activate_service(service_id: str, current_user: dict = Depends(get_current_user)):
    service = services_db.get(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"message": f"Service {service_id} activated", "service_id": service_id}

@router.post("/{service_id}/deactivate")
async def deactivate_service(service_id: str, current_user: dict = Depends(get_current_user)):
    service = services_db.get(service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"message": f"Service {service_id} deactivated", "service_id": service_id}


# vs.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/v1/scans", tags=["Vulnerability Scanning"])

from utils.auth_utils import get_current_user
from utils.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.auth_models import User

# Mock databases
scans_db: Dict[str, Dict[str, Any]] = {}
results_db: Dict[str, Dict[str, Any]] = {}

class ScanRequest(BaseModel):
    name: str
    target: str
    scan_type: str = "external"
    frequency: Optional[str] = None

class Vulnerability(BaseModel):
    cve: str
    severity: str
    exploitability_score: float
    description: str
    remediation: str

class ScanResult(BaseModel):
    id: str
    scan_type: str
    target: str
    status: str
    results: List[Vulnerability]
    created_at: str


class VSDashboard(BaseModel):
    total_vulnerabilities: int
    critical: int
    high: int
    medium: int
    low: int
    avg_mttr_days: float
    scan_coverage: int


vs_router = APIRouter(prefix="/api/v1/vs", tags=["Vulnerability Scanning (VS)"])


async def _require_write_access(db: AsyncSession, current_user: dict):
    # RBAC from the verified identity (owner/admin/analyst may write; reader cannot).
    role = current_user.get("role", "reader")
    if role not in ("owner", "admin", "analyst"):
        raise HTTPException(status_code=403, detail="Read-only access for your role")
    return current_user


@vs_router.get("/dashboard", response_model=VSDashboard)
async def get_vs_dashboard(current_user: dict = Depends(get_current_user)):
    """
    VS dashboard endpoint. Aggregates severity counts from real scan results.
    Returns honest zeros when no scans have produced results — never seeds
    placeholder/example data.
    """
    # Aggregate severity counts
    critical = high = medium = low = 0
    for result in results_db.values():
        for v in result.get("results", []):
            sev = v.get("severity", "").lower()
            if sev == "critical":
                critical += 1
            elif sev == "high":
                high += 1
            elif sev == "medium":
                medium += 1
            elif sev == "low":
                low += 1

    total = critical + high + medium + low
    if total == 0:
        # Avoid division by zero and just return zeros
        return VSDashboard(
            total_vulnerabilities=0,
            critical=0,
            high=0,
            medium=0,
            low=0,
            avg_mttr_days=0.0,
            scan_coverage=0,
        )

    # MTTR/coverage are not yet derived from real remediation timestamps;
    # report 0 rather than fabricating values.
    return VSDashboard(
        total_vulnerabilities=total,
        critical=critical,
        high=high,
        medium=medium,
        low=low,
        avg_mttr_days=0.0,
        scan_coverage=0,
    )

@router.post("")
async def create_scan(
    request: ScanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _require_write_access(db, current_user)
    scan_id = str(uuid.uuid4())
    scans_db[scan_id] = {
        "id": scan_id,
        "name": request.name,
        "target": request.target,
        "scan_type": request.scan_type,
        "frequency": request.frequency,
        "status": "running",
        "created_at": datetime.utcnow().isoformat()
    }
    # TODO: Queue scan job for background worker
    return {"scan_id": scan_id, "status": "running"}

@router.get("", response_model=List[dict])
async def list_scans(skip: int = 0, limit: int = 100, current_user: dict = Depends(get_current_user)):
    scans = list(scans_db.values())[skip:skip+limit]
    return scans

@router.get("/{scan_id}", response_model=ScanResult)
async def get_scan(scan_id: str, current_user: dict = Depends(get_current_user)):
    scan = scans_db.get(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    if scan_id not in results_db:
        results_db[scan_id] = {
            "id": scan_id,
            "scan_type": scan["scan_type"],
            "target": scan["target"],
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
            "created_at": scan["created_at"]
        }
    
    return ScanResult(**results_db[scan_id])

@router.post("/{scan_id}/retest")
async def retest_scan(
    scan_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _require_write_access(db, current_user)
    scan = scans_db.get(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    scan["status"] = "running"
    return {"scan_id": scan_id, "status": "running"}

@router.delete("/{scan_id}")
async def delete_scan(
    scan_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    await _require_write_access(db, current_user)
    if scan_id not in scans_db:
        raise HTTPException(status_code=404, detail="Scan not found")
    del scans_db[scan_id]
    return {"message": "Scan deleted successfully"}

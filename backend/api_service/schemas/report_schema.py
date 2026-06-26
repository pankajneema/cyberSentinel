from pydantic import BaseModel
from typing import List, Optional, Literal, Any, Dict


Module = Literal["all", "asm", "vs"]
ReportType = Literal["executive", "technical", "compliance", "assets", "vulnerability"]
ReportFormat = Literal["pdf", "csv", "json"]
Frequency = Literal["daily", "weekly", "monthly"]


# ---------------------------------------------------
# Generate
# ---------------------------------------------------
class GenerateReportRequest(BaseModel):
    name: Optional[str] = None
    module: Module = "all"
    report_type: ReportType = "executive"
    format: ReportFormat = "pdf"
    date_range: Optional[str] = "all"
    sections: Optional[List[str]] = None


# ---------------------------------------------------
# Report responses
# ---------------------------------------------------
class ReportResponse(BaseModel):
    id: str
    name: str
    module: str
    type: str
    format: str
    dateRange: Optional[str] = None
    date: Optional[str] = None
    size: str
    sizeBytes: int
    sections: List[str]
    status: str
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    content: Optional[Dict[str, Any]] = None


class ReportListResponse(BaseModel):
    items: List[ReportResponse]
    total: int


# ---------------------------------------------------
# Scheduled reports
# ---------------------------------------------------
class ScheduledReportCreate(BaseModel):
    name: str
    module: Module = "all"
    report_type: ReportType = "executive"
    format: ReportFormat = "pdf"
    frequency: Frequency = "weekly"
    recipients: Optional[List[str]] = None
    enabled: bool = True


class ScheduledReportUpdate(BaseModel):
    name: Optional[str] = None
    module: Optional[Module] = None
    report_type: Optional[ReportType] = None
    format: Optional[ReportFormat] = None
    frequency: Optional[Frequency] = None
    recipients: Optional[List[str]] = None
    enabled: Optional[bool] = None


class ScheduledReportResponse(BaseModel):
    id: str
    name: str
    module: str
    type: str
    format: str
    frequency: str
    recipients: List[str]
    enabled: bool
    nextRun: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class ScheduledReportListResponse(BaseModel):
    items: List[ScheduledReportResponse]
    total: int

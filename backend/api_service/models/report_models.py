"""
SQLAlchemy Models for Reports.

Reports are org-scoped, generated artifacts whose `content` is computed from
real tenant data (assets, ASM/VS signals) at generation time — never fabricated.
ScheduledReport stores recurring-generation intent (delivered out of band).
"""

from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Boolean
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.sql import func
import uuid

from utils.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, default=generate_uuid)

    org_id = Column(
        String,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # Supabase user id of the creator (the JWT `sub`), not a FK.
    user_id = Column(String, nullable=True, index=True)

    name = Column(String(255), nullable=False)
    module = Column(String(20), nullable=False, default="all")        # all | asm | vs
    report_type = Column(String(50), nullable=False)                  # executive | technical | compliance | assets | vulnerability
    format = Column(String(10), nullable=False, default="pdf")        # pdf | csv | json
    date_range = Column(String(20), nullable=True)                    # 7d | 30d | 90d | custom | all

    sections = Column(ARRAY(String), default=list)
    status = Column(String(20), nullable=False, default="ready")      # ready | generating | failed

    # The generated report payload (summary stats, key findings, recommendations).
    content = Column(JSONB, nullable=True)
    size_bytes = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Report id={self.id} name={self.name} module={self.module}>"

    def _human_size(self) -> str:
        n = self.size_bytes or 0
        if n < 1024:
            return f"{n} B"
        if n < 1024 * 1024:
            return f"{n / 1024:.1f} KB"
        return f"{n / (1024 * 1024):.1f} MB"

    def to_dict(self, include_content: bool = False) -> dict:
        d = {
            "id": self.id,
            "name": self.name,
            "module": self.module,
            "type": self.report_type,
            "format": self.format,
            "dateRange": self.date_range,
            "date": self.created_at.isoformat() if self.created_at else None,
            "size": self._human_size(),
            "sizeBytes": self.size_bytes or 0,
            "sections": self.sections or [],
            "status": self.status,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_content:
            d["content"] = self.content or {}
        return d


class ScheduledReport(Base):
    __tablename__ = "scheduled_reports"

    id = Column(String, primary_key=True, default=generate_uuid)

    org_id = Column(
        String,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    user_id = Column(String, nullable=True, index=True)

    name = Column(String(255), nullable=False)
    module = Column(String(20), nullable=False, default="all")        # all | asm | vs
    report_type = Column(String(50), nullable=False)                  # executive | technical | ...
    format = Column(String(10), nullable=False, default="pdf")        # pdf | csv | json
    frequency = Column(String(20), nullable=False, default="weekly")  # daily | weekly | monthly

    recipients = Column(ARRAY(String), default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<ScheduledReport id={self.id} name={self.name} freq={self.frequency}>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "module": self.module,
            "type": self.report_type,
            "format": self.format,
            "frequency": self.frequency,
            "recipients": self.recipients or [],
            "enabled": self.enabled,
            "nextRun": self.next_run_at.isoformat() if self.next_run_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }

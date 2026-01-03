# models/asm_models.py

import uuid
from sqlalchemy import Column, String, DateTime, Enum, JSON
from sqlalchemy.sql import func

from utils.database import Base


class AsmDiscovery(Base):
    __tablename__ = "asm_discoveries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False)

    name = Column(String, nullable=False)
    asset_type = Column(
        Enum("domain", "cloud", "saas", name="asm_asset_type"),
        nullable=False,
    )
    target_source = Column(
        Enum("FROM_ASSET", "MANUAL_ENTRY", name="asm_target_source"),
        nullable=False,
    )

    asset_ids = Column(JSON, nullable=True)
    manual_targets = Column(JSON, nullable=True)

    intensity = Column(
        Enum("LIGHT", "NORMAL", "DEEP", name="asm_intensity"),
        default="NORMAL",
    )

    # 🔥 FIXED ENUM
    schedule_type = Column(
        Enum("QUICK", "INTERVAL", "CRON", name="asm_schedule_type"),
        default="QUICK",
    )
    schedule_value = Column(String, nullable=True)

    status = Column(
        Enum("ACTIVE","PENDING","PAUSED", "DELETED", name="asm_status"),
        default="PENDING",
    )

    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "asset_type": self.asset_type,
            "intensity": self.intensity,
            "schedule_type": self.schedule_type,
            "schedule_value": self.schedule_value,
            "status": self.status,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AsmDiscoveryRun(Base):
    __tablename__ = "asm_discovery_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, nullable=False)
    user_id = Column(String, nullable=False)

    triggered_by = Column(
        Enum("UI", "CRON", "API", name="asm_trigger_source"),
        nullable=False,
    )

    run_mode = Column(
        Enum("QUICK", "SCHEDULED", name="asm_run_mode"),
        nullable=False,
    )

    status = Column(
        Enum("PENDING", "RUNNING", "COMPLETED", "FAILED", name="asm_run_status"),
        default="PENDING",
    )

    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(String, nullable=True)

    summary = Column(JSON, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "triggered_by": self.triggered_by,
            "run_mode": self.run_mode,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "summary": self.summary,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

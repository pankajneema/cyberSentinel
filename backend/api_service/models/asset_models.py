"""
SQLAlchemy Models for Assets
"""

from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.sql import func
import uuid

from utils.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class Asset(Base):
    __tablename__ = "assets"

    id = Column(String, primary_key=True, default=generate_uuid)

    # Tenant scope (Phase 3). Nullable during backfill, then enforced NOT NULL.
    org_id = Column(
        String,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Creator's Supabase user id (the JWT `sub`). NOT a foreign key — identity
    # lives in Supabase / member_profiles, not the legacy `users` table. Tenant
    # ownership is enforced via org_id.
    user_id = Column(String, nullable=True, index=True)

    name = Column(String(255), nullable=False, index=True)
    type = Column(String(50), nullable=False, index=True)   # domain, ip, cloud, repo, saas, user
    exposure = Column(String(50), default="internal")       # public, internal
    # Real exposure score (0–100) computed by scoring/exposure.py from ASM data.
    # NULL means the asset has never been scored (shown as "Unscanned" in the UI),
    # which is distinct from a real computed score of 0 (severity "info").
    risk_score = Column(Integer, nullable=True, default=None)
    last_scored_at = Column(DateTime(timezone=True), nullable=True)
    tags = Column(ARRAY(String), default=list)

    status = Column(String(50), default="active")           # active, inactive, archived
    last_seen = Column(String(100), nullable=True)

    description = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Asset id={self.id} name={self.name} type={self.type}>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "org_id": self.org_id,
            "user_id": self.user_id,
            "name": self.name,
            "type": self.type,
            "exposure": self.exposure,
            "risk_score": self.risk_score,
            "last_scored_at": self.last_scored_at.isoformat() if self.last_scored_at else None,
            "tags": self.tags or [],
            "status": self.status,
            "last_seen": self.last_seen,
            "description": self.description,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
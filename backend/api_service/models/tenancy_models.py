"""
Tenancy models for the Supabase-auth era.

These are additive and keyed by the Supabase user id (the JWT `sub`). They are
the new source of truth for *who belongs to which org and with what role*.
Application data (assets, ASM, reporting) will gain an `org_id` FK to
`organizations.id` during Phase 3.

Identity (passwords, email verification, OAuth, MFA) lives entirely in
Supabase. We never store credentials here.
"""

from datetime import datetime
import uuid

from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, JSON, UniqueConstraint
from sqlalchemy.orm import relationship

from utils.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Organization(Base):
    """The tenant root. Every piece of application data scopes to one of these."""

    __tablename__ = "organizations"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    plan = Column(String, nullable=False, default="starter")
    owner_user_id = Column(String, nullable=False, index=True)  # Supabase sub of the owner
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    members = relationship("MemberProfile", back_populates="organization")


class MemberProfile(Base):
    """
    One row per (org, supabase user). Holds the app-side role and the synced
    profile fields. `supabase_user_id` is the JWT `sub`.
    """

    __tablename__ = "member_profiles"
    __table_args__ = (
        UniqueConstraint("org_id", "supabase_user_id", name="uq_org_member"),
    )

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    supabase_user_id = Column(String, nullable=False, index=True)  # JWT sub (uuid)
    email = Column(String, nullable=False, index=True)
    full_name = Column(String, nullable=True)
    role = Column(String, nullable=False, default="reader")  # owner | admin | analyst | reader
    avatar_url = Column(String, nullable=True)
    country = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    deleted_at = Column(DateTime, nullable=True)  # soft delete
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    organization = relationship("Organization", back_populates="members")


class MemberSettings(Base):
    """Notification + UI preferences, one row per (org, user)."""

    __tablename__ = "member_settings"
    __table_args__ = (
        UniqueConstraint("org_id", "supabase_user_id", name="uq_org_member_settings"),
    )

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    supabase_user_id = Column(String, nullable=False, index=True)
    notifications = Column(JSON, nullable=False, default=dict)
    preferences = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OrgInvite(Base):
    """
    Invitation to join an organization (new tenancy model). Tokens are single-use
    and expiring. Supersedes the legacy `team_invites` table tied to `companies`.
    """

    __tablename__ = "org_invites"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False, default="reader")  # admin | analyst | reader
    token = Column(String, nullable=False, unique=True, index=True)
    status = Column(String, nullable=False, default="pending")  # pending | accepted | declined | revoked
    invited_by = Column(String, nullable=False)  # Supabase sub of inviter
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    responded_at = Column(DateTime, nullable=True)


class AuditLog(Base):
    """Append-only audit trail for security-relevant actions."""

    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, index=True, nullable=True)
    actor_user_id = Column(String, index=True, nullable=True)  # Supabase sub
    action = Column(String, nullable=False)                    # e.g. member.invited
    target = Column(String, nullable=True)                     # affected entity id/email
    meta = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

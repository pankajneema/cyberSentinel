"""
Self-hosted identity models.

We are the identity provider now (Supabase is gone — its project was deleted
and is unrecoverable). `User` holds credentials; `MemberProfile` (in
tenancy_models.py) stays the per-(org, user) membership/role record and points
at `User.id` via its `user_id` FK.
"""

from datetime import datetime
import uuid

from sqlalchemy import Column, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from utils.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    """One row per person. Password-only accounts have a null-less password_hash;
    OAuth-only accounts (no password ever set) have password_hash=NULL."""

    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=True)
    full_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    oauth_identities = relationship(
        "OAuthIdentity", back_populates="user", cascade="all, delete-orphan"
    )


class OAuthIdentity(Base):
    """Links a User to a provider account. A person can have both a password
    and one or more linked identities (find-or-create-by-email at OAuth login)."""

    __tablename__ = "oauth_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_oauth_provider_identity"),
    )

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String, nullable=False)  # "google" | "github"
    provider_user_id = Column(String, nullable=False)
    email = Column(String, nullable=True)  # email claimed by the provider at link time, for audit
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="oauth_identities")


class RefreshToken(Base):
    """DB-backed so sessions can actually be revoked (single-token logout and
    'sign out all devices' both need this — a stateless refresh JWT couldn't
    support either). Only a hash of the opaque token is stored; the raw value
    is returned to the client once and never persisted."""

    __tablename__ = "refresh_tokens"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PasswordResetToken(Base):
    """Same hash-at-rest shape as RefreshToken. `used_at` makes tokens single-use."""

    __tablename__ = "password_reset_tokens"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

"""
SQLAlchemy models for in-app notifications and per-user notification preferences.

Org-scoped (org_id) and recipient-scoped (user_id = Supabase sub). Notifications
are real, derived from the org's audit trail at read-time until dedicated
producers exist; preferences persist per (org, user).
"""

from datetime import datetime
import uuid

from sqlalchemy import Column, String, DateTime, Boolean, Text, UniqueConstraint

from utils.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=False, index=True)   # recipient Supabase sub
    title = Column(String, nullable=False)
    body = Column(Text, nullable=True)
    type = Column(String, nullable=False, default="info")  # category
    link = Column(String, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "org_id": self.org_id,
            "user_id": self.user_id,
            "title": self.title,
            "body": self.body,
            "type": self.type,
            "link": self.link,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_notification_pref_user"),
    )

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    email = Column(Boolean, nullable=False, default=True)
    push = Column(Boolean, nullable=False, default=False)
    in_app = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "org_id": self.org_id,
            "user_id": self.user_id,
            "email": self.email,
            "push": self.push,
            "in_app": self.in_app,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

"""
SQLAlchemy Models for Team Tasks.

Tasks are org-scoped work items (remediation/assignments) and their message
threads. Every row carries `org_id`; all access is filtered by the caller's
tenant. Nothing here is seeded or fabricated — rows exist only when a member
of the org creates them.
"""

from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
import uuid

from utils.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=generate_uuid)

    org_id = Column(
        String,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # user id of the creator (the JWT `sub`), not a FK.
    user_id = Column(String, nullable=True, index=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(20), nullable=False, default="medium")     # critical | high | medium | low
    status = Column(String(20), nullable=False, default="pending")      # pending | in_progress | completed | overdue
    assignee_id = Column(String, nullable=True)
    assignee_name = Column(String(255), nullable=True)
    due_date = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)
    asset_name = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Task id={self.id} title={self.title} status={self.status}>"

    def to_dict(self, messages: list | None = None) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "status": self.status,
            "assignee_id": self.assignee_id,
            "assignee_name": self.assignee_name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "due_date": self.due_date,
            "completed_at": self.completed_at,
            "asset_name": self.asset_name,
            "messages": messages or [],
        }


class TaskMessage(Base):
    __tablename__ = "task_messages"

    id = Column(String, primary_key=True, default=generate_uuid)

    task_id = Column(
        String,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    org_id = Column(String, nullable=True, index=True)

    sender = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    platform = Column(String(20), nullable=False, default="internal")   # internal | slack | jira | email

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return f"<TaskMessage id={self.id} task_id={self.task_id}>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "sender": self.sender,
            "message": self.message,
            "timestamp": self.created_at.isoformat() if self.created_at else None,
            "platform": self.platform,
        }

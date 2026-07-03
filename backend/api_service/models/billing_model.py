from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from datetime import datetime
import uuid

from utils.database import Base


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, unique=True, index=True, nullable=False)
    # Tenant column so billing can be scoped/reported per org (nullable: backfilled
    # from the user's org; not a hard FK yet to keep the migration additive).
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)

    plan = Column(String, default="starter")        # starter | pro | enterprise
    billing_period = Column(String, default="monthly")
    status = Column(String, default="active")       # active | cancelled

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, index=True, nullable=False)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)

    amount = Column(Float, nullable=False)
    status = Column(String, default="pending")      # paid | pending | failed
    created_at = Column(DateTime, default=datetime.utcnow)

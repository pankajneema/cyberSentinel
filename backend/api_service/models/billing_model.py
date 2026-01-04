from sqlalchemy import Column, String, Float, DateTime
from datetime import datetime
import uuid

from utils.database import Base


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, unique=True, index=True, nullable=False)

    plan = Column(String, default="starter")        # starter | pro | enterprise
    billing_period = Column(String, default="monthly")
    status = Column(String, default="active")       # active | cancelled

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, index=True, nullable=False)

    amount = Column(Float, nullable=False)
    status = Column(String, default="pending")      # paid | pending | failed
    created_at = Column(DateTime, default=datetime.utcnow)

"""Marketing and lead capture models."""

from sqlalchemy import Column, String, DateTime
from datetime import datetime
import uuid
from utils.database import Base


def generate_uuid():
    return str(uuid.uuid4())


class NewsletterLead(Base):
    __tablename__ = "newsletter"

    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String, nullable=False, index=True)
    service = Column(String, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

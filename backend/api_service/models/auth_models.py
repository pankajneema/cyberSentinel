"""
SQLAlchemy Models for Users, Companies, and Profiles
"""

from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from utils.database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Company(Base):
    __tablename__ = "companies"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    plan = Column(String, default="starter")
    owner_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    users = relationship("User", back_populates="company", foreign_keys="User.company_id")

class User(Base):
    __tablename__ = "users"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False)
    company_id = Column(String, ForeignKey("companies.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    profile = relationship("Profile", back_populates="user", uselist=False)
    company = relationship("Company", back_populates="users", foreign_keys=[company_id])

class Profile(Base):
    __tablename__ = "profiles"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    role = Column(String, nullable=False)
    country = Column(String)
    phone = Column(String)
    avatar_url = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="profile")

class UserSettings(Base):
    __tablename__ = "user_settings"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    notifications = Column(JSON, nullable=False, default=dict)
    preferences = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TeamInvite(Base):
    __tablename__ = "team_invites"

    id = Column(String, primary_key=True, default=generate_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False)
    email = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False, default="reader")
    status = Column(String, nullable=False, default="pending")  # pending | accepted | declined
    token = Column(String, nullable=False, unique=True)
    invited_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    responded_at = Column(DateTime, nullable=True)


class TeamRole(Base):
    __tablename__ = "team_roles"

    id = Column(String, primary_key=True, default=generate_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

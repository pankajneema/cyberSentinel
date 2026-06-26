from pydantic import BaseModel
from typing import Optional


class NotificationResponse(BaseModel):
    id: str
    title: str
    body: Optional[str] = None
    type: str
    link: Optional[str] = None
    is_read: bool
    created_at: Optional[str] = None


class UnreadCountResponse(BaseModel):
    count: int


class NotificationPreferenceResponse(BaseModel):
    email: bool
    push: bool
    in_app: bool


class NotificationPreferenceUpdate(BaseModel):
    email: Optional[bool] = None
    push: Optional[bool] = None
    in_app: Optional[bool] = None

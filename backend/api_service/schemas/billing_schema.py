from pydantic import BaseModel
from datetime import datetime


# ---------------------------------------------------
# Subscription Request
# ---------------------------------------------------
class SubscriptionRequest(BaseModel):
    plan: str               # starter | pro | enterprise
    billing_period: str     # monthly | annual


# ---------------------------------------------------
# Subscription Response
# ---------------------------------------------------
class SubscriptionResponse(BaseModel):
    plan: str
    billing_period: str
    status: str

    class Config:
        from_attributes = True


# ---------------------------------------------------
# Invoice Response
# ---------------------------------------------------
class InvoiceResponse(BaseModel):
    id: str
    amount: float
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from typing import Optional

from utils.database import get_db
from models.marketing_models import NewsletterLead
from utils.emailer import send_contact_notification, send_early_access_notification

router = APIRouter(prefix="/api/v1/marketing", tags=["Marketing"])


class ContactRequest(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    company: Optional[str] = None
    subject: str
    message: str


class EarlyAccessRequest(BaseModel):
    email: EmailStr
    service: str


@router.post("/contact")
async def contact_us(payload: ContactRequest):
    ok = send_contact_notification(
        {
            "first_name": payload.first_name,
            "last_name": payload.last_name,
            "email": payload.email,
            "company": payload.company or "",
            "subject": payload.subject,
            "message": payload.message,
            "submitted_at": datetime.utcnow().isoformat(),
        }
    )
    return {"message": "Contact request received", "sent": bool(ok)}


@router.post("/early-access")
async def early_access(payload: EarlyAccessRequest, db: AsyncSession = Depends(get_db)):
    if not payload.service.strip():
        raise HTTPException(status_code=400, detail="Service is required")

    lead = NewsletterLead(email=payload.email, service=payload.service.strip())
    db.add(lead)
    await db.commit()

    ok = send_early_access_notification(
        {
            "email": payload.email,
            "service": payload.service.strip(),
            "submitted_at": datetime.utcnow().isoformat(),
        }
    )

    return {"message": "Early access request received", "sent": bool(ok)}

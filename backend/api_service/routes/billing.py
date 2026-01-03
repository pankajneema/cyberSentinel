from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from utils.database import get_db
from utils.auth_utils import get_current_user
from models.billing_model import Subscription, Invoice
from schemas.billing_schema import (
    SubscriptionRequest,
    SubscriptionResponse,
    InvoiceResponse,
)

router = APIRouter(
    prefix="/api/v1/billing",
    tags=["Billing"],
)

# ---------------------------------------------------
# Get current subscription
# ---------------------------------------------------
@router.get("/plan", response_model=SubscriptionResponse)
async def get_plan(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()

    if not sub:
        return SubscriptionResponse(
            plan="starter",
            billing_period="monthly",
            status="trial",
        )

    return sub


# ---------------------------------------------------
# Subscribe / Change plan
# ---------------------------------------------------
@router.post("/subscribe")
async def subscribe(
    request: SubscriptionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()

    if not sub:
        sub = Subscription(
            user_id=user_id,
            plan=request.plan,
            billing_period=request.billing_period,
            status="active",
        )
        db.add(sub)
    else:
        sub.plan = request.plan
        sub.billing_period = request.billing_period
        sub.status = "active"

    await db.commit()

    return {
        "message": "Subscription updated",
        "plan": request.plan,
    }


# ---------------------------------------------------
# Upgrade plan (shortcut)
# ---------------------------------------------------
@router.post("/upgrade")
async def upgrade_plan(
    plan_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    new_plan = plan_data.get("plan")

    if not new_plan:
        raise HTTPException(status_code=400, detail="Plan is required")

    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()

    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    sub.plan = new_plan
    await db.commit()

    return {"message": "Plan upgraded", "plan": new_plan}


# ---------------------------------------------------
# Cancel subscription
# ---------------------------------------------------
@router.post("/cancel")
async def cancel_subscription(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    result = await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )
    sub = result.scalar_one_or_none()

    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    sub.status = "cancelled"
    await db.commit()

    return {"message": "Subscription cancelled"}


# ---------------------------------------------------
# List invoices (user only)
# ---------------------------------------------------
@router.get("/invoices", response_model=List[InvoiceResponse])
async def list_invoices(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    result = await db.execute(
        select(Invoice).where(Invoice.user_id == user_id)
    )
    return result.scalars().all()


# ---------------------------------------------------
# Get single invoice (secure)
# ---------------------------------------------------
@router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]

    result = await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id,
            Invoice.user_id == user_id,
        )
    )
    invoice = result.scalar_one_or_none()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return invoice

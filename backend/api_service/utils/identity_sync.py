"""
Just-in-time identity provisioning.

On the first authenticated request from a Supabase user we ensure they have:
  - a MemberProfile (their app-side role + profile fields), and
  - an Organization (created automatically for a brand-new owner).

This keeps PostgreSQL as the source of truth for tenancy while Supabase owns
identity. It is idempotent: repeated calls only update mutable fields.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenancy_models import Organization, MemberProfile


async def sync_profile_and_org(
    db: AsyncSession,
    *,
    supabase_user_id: str,
    email: str,
    full_name: str,
    role: str,
    org_name_hint: Optional[str] = None,
) -> MemberProfile:
    """Return the user's MemberProfile, creating org + profile on first sight."""

    result = await db.execute(
        select(MemberProfile).where(
            MemberProfile.supabase_user_id == supabase_user_id,
            MemberProfile.deleted_at.is_(None),
        )
    )
    profile = result.scalar_one_or_none()

    if profile is not None:
        # Keep mutable, identity-owned fields fresh without clobbering role.
        changed = False
        if profile.email != email:
            profile.email = email
            changed = True
        if full_name and profile.full_name != full_name:
            profile.full_name = full_name
            changed = True
        if changed:
            await db.commit()
            await db.refresh(profile)
        return profile

    # First time we have seen this user: create their organization + owner profile.
    org = Organization(
        name=org_name_hint or (email.split("@")[0] + "'s Organization"),
        owner_user_id=supabase_user_id,
    )
    db.add(org)
    await db.flush()  # get org.id

    profile = MemberProfile(
        org_id=org.id,
        supabase_user_id=supabase_user_id,
        email=email,
        full_name=full_name,
        # A brand-new self-signup becomes the owner of their own org.
        role="owner",
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile

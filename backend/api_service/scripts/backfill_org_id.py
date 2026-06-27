"""
Backfill `org_id` on existing rows (Phase 3).

Maps legacy `user_id`-scoped rows to the new tenant model by resolving each
user's organization via member_profiles. Idempotent: only fills NULL org_id.

Run once after the org_id columns are added and users are migrated:
    python scripts/backfill_org_id.py
"""

import asyncio

from sqlalchemy import select, update

from utils.database import AsyncSessionLocal
from models.tenancy_models import MemberProfile
from models.asset_models import Asset
from models.asm_models import AsmDiscovery


async def _user_to_org(db) -> dict[str, str]:
    """Map supabase_user_id -> org_id from member_profiles."""
    rows = (await db.execute(select(MemberProfile))).scalars().all()
    return {m.supabase_user_id: m.org_id for m in rows}


async def backfill() -> None:
    async with AsyncSessionLocal() as db:
        mapping = await _user_to_org(db)
        if not mapping:
            print("No member_profiles yet — migrate users first.")
            return

        filled = 0
        for user_id, org_id in mapping.items():
            # Assets
            res = await db.execute(
                update(Asset)
                .where(Asset.user_id == user_id, Asset.org_id.is_(None))
                .values(org_id=org_id)
            )
            filled += res.rowcount or 0
            # ASM discoveries (children inherit via discovery in a later pass)
            res = await db.execute(
                update(AsmDiscovery)
                .where(AsmDiscovery.user_id == user_id, AsmDiscovery.org_id.is_(None))
                .values(org_id=org_id)
            )
            filled += res.rowcount or 0
        await db.commit()
        print(f"Backfilled org_id on {filled} rows.")


if __name__ == "__main__":
    asyncio.run(backfill())

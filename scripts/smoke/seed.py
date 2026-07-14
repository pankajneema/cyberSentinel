"""Seed a smoke-test org + asset + ASM discovery + VS scan/run + a member, then
print shell export lines. Use with eval:

    eval "$($PY scripts/smoke/seed.py)"

Creates a member so the terminal notification has a recipient. Everything is
tagged name='SMOKE ...' so cleanup can delete by name.
"""
import asyncio, uuid
from utils.database import AsyncSessionLocal
from models.tenancy_models import Organization, MemberProfile
from models.asset_models import Asset
from models.asm_models import AsmDiscovery
from models.vs_models import VsScanProfile, VsScan, VsScanRun, VsScanTarget


async def main():
    async with AsyncSessionLocal() as db:
        uid = "smoke-" + uuid.uuid4().hex[:8]
        org = Organization(name="SMOKE Org", owner_user_id=uid)
        db.add(org); await db.flush()
        db.add(MemberProfile(org_id=org.id, supabase_user_id=uid, email="smoke@example.com"))
        asset = Asset(name="example.com", type="domain", org_id=org.id)
        db.add(asset); await db.flush()
        disc = AsmDiscovery(user_id=uid, name="SMOKE asm", asset_type="domain",
                            target_source="MANUAL_ENTRY", org_id=org.id, intensity="LIGHT",
                            manual_targets=["example.com"], asset_ids=[asset.id])
        db.add(disc); await db.flush()
        prof = VsScanProfile(org_id=org.id, user_id=uid, name="SMOKE prof")
        db.add(prof); await db.flush()
        scan = VsScan(org_id=org.id, user_id=uid, name="SMOKE vs", profile_id=prof.id)
        db.add(scan); await db.flush()
        run = VsScanRun(scan_id=scan.id, org_id=org.id)
        db.add(run); await db.flush()
        db.add(VsScanTarget(scan_run_id=run.id, org_id=org.id, asset_id=asset.id, host="example.com"))
        await db.commit()
        print(f"export ORG_ID={org.id}")
        print(f"export ASSET_ID={asset.id}")
        print(f"export DISC_ID={disc.id}")
        print(f"export VS_SCAN_ID={scan.id}")
        print(f"export VS_RUN_ID={run.id}")
        print(f"export CA_TASK_ID={uuid.uuid4()}")


asyncio.run(main())

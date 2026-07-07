"""One-time repair of the ca_audit_trail hash chain.

Rows written before the ca_fixes migration forked the chain (autoflush=False
meant sibling rows in one transaction all linked to the same predecessor).
This script relinks and rehashes every org's trail in seq order.

It must UPDATE trail rows, which the append-only trigger forbids — so it
disables the trigger inside a single transaction, rewrites the chain, and
re-enables it. Every execution is itself recorded as a trail row
(action=trail.rechained) carrying the count of rewritten rows, so the repair
is visible to auditors rather than silent.

Run once after `alembic upgrade head`:
    python -m scripts.rechain_ca_trail
Idempotent: verified-intact orgs are skipped.
"""

import asyncio
import hashlib
import json
import sys
from pathlib import Path

from sqlalchemy import select, text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.database import AsyncSessionLocal, init_db  # noqa: E402
import models.tenancy_models  # noqa: F401,E402
from models.ca_models import CaAuditTrail  # noqa: E402
from ca.engine import ca_trail  # noqa: E402


def _canonical(meta) -> str:
    return json.dumps(meta or {}, sort_keys=True, separators=(",", ":"), default=str)


def _row_hash(prev, row) -> str:
    return hashlib.sha256(
        f"{prev or ''}|{row.org_id}|{row.actor_user_id or ''}|{row.action}|"
        f"{row.target or ''}|{_canonical(row.meta)}|{row.at.isoformat()}".encode()
    ).hexdigest()


async def main() -> None:
    await init_db()
    async with AsyncSessionLocal() as db:
        org_ids = (await db.execute(select(CaAuditTrail.org_id).distinct())).scalars().all()
        for org_id in org_ids:
            rows = (
                await db.execute(
                    select(CaAuditTrail).where(CaAuditTrail.org_id == org_id)
                    .order_by(CaAuditTrail.seq)
                )
            ).scalars().all()
            prev, broken = None, 0
            for r in rows:
                expected = _row_hash(prev, r)
                if r.prev_hash != prev or r.row_hash != expected:
                    broken += 1
                prev = r.row_hash
            if not broken:
                print(f"org {org_id[:8]}: chain intact ({len(rows)} rows)")
                continue

            await db.execute(text("ALTER TABLE ca_audit_trail DISABLE TRIGGER trg_ca_trail_immutable"))
            prev = None
            for r in rows:
                new_hash = _row_hash(prev, r)
                await db.execute(
                    text("UPDATE ca_audit_trail SET prev_hash=:p, row_hash=:h WHERE id=:i"),
                    {"p": prev, "h": new_hash, "i": r.id},
                )
                prev = new_hash
            await db.execute(text("ALTER TABLE ca_audit_trail ENABLE TRIGGER trg_ca_trail_immutable"))
            await db.commit()
            # Record the repair on the (now consistent) chain.
            await ca_trail(db, org_id, None, "trail.rechained", None,
                           {"rewritten_rows": broken, "total_rows": len(rows)})
            await db.commit()
            print(f"org {org_id[:8]}: re-chained {broken}/{len(rows)} rows")
    print("done")


if __name__ == "__main__":
    asyncio.run(main())

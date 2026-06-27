"""
Export existing PostgreSQL users for import into Supabase Auth.

Supabase cannot accept arbitrary legacy password hashes via the dashboard CSV
import, so the safe, standard path is:

  1. Export users (email + name + role) -> CSV.
  2. Invite/import them into Supabase WITHOUT passwords (Supabase sends each a
     "set your password" / magic-link email), OR bulk-create via the Admin API
     with email_confirm=true and have them use "forgot password" on first login.
  3. After everyone is migrated, run migration 0002 to drop hashed_password.

This script only does step 1 (read-only export). It never prints password hashes.

Usage:
    python scripts/export_users_for_supabase.py > users_export.csv
"""

import asyncio
import csv
import sys

from sqlalchemy import select

from utils.database import AsyncSessionLocal
from models.auth_models import User


async def export() -> None:
    writer = csv.writer(sys.stdout)
    writer.writerow(["email", "name", "role", "company_id", "is_active"])
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(User))).scalars().all()
        for u in rows:
            writer.writerow([u.email, u.name, u.role, u.company_id or "", u.is_active])


if __name__ == "__main__":
    asyncio.run(export())

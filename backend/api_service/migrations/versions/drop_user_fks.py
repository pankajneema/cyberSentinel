"""drop user_id -> users.id FKs on assets and asm_settings

Supabase owns identity (users live in member_profiles, not the legacy `users`
table), so these foreign keys can never be satisfied by a Supabase user id and
must be dropped. Tenancy is enforced via org_id instead.

Revision ID: drop_user_fks
Revises: e79bfbe12d8c
Create Date: 2026-06-26
"""
from alembic import op

revision = "drop_user_fks"
down_revision = "e79bfbe12d8c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_user_id_fkey")
    op.execute("ALTER TABLE asm_settings DROP CONSTRAINT IF EXISTS asm_settings_user_id_fkey")


def downgrade() -> None:
    # Intentionally not re-added — the legacy FK is incompatible with Supabase ids.
    pass

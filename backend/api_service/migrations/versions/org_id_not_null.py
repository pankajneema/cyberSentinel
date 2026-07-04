"""Backfill org_id everywhere and enforce NOT NULL where safe (tenant integrity).

Every tenant-scoped table has a nullable ``org_id`` today; the application layer
scopes correctly, but a NULL is a latent isolation hole. This migration:

  1. Backfills ``org_id`` on the parent tables (asm_discoveries, assets) from the
     owner's member_profile (via user_id → org).
  2. Backfills ``org_id`` on every ASM child table from its parent discovery
     (child.asm_discovery_id → asm_discoveries.org_id).
  3. Sets ``org_id`` NOT NULL — but ONLY on tables where a post-backfill null
     count is 0, so a residual legacy NULL (e.g. a user with no member_profile)
     cannot fail the whole migration. Tables still holding NULLs are left nullable
     and logged; re-run after cleaning the data to enforce them.

Reversible: downgrade sets the columns nullable again (does not un-backfill).

⚠️ Run against a live DB and check the emitted NOTICEs — some tables may stay
nullable if their backfill was incomplete.
"""
from alembic import op
import sqlalchemy as sa

revision = "org_id_not_null"
down_revision = "org_scope_and_perf_indexes"
branch_labels = None
depends_on = None

# ASM child tables: org_id comes from the parent discovery.
_CHILD_TABLES = [
    "asm_discovery_runs", "asm_subdomains", "asm_ips", "asm_ports",
    "asm_services", "asm_ssl_certs", "asm_api_endpoints", "asm_cloud_resources",
    "asm_admin_endpoints", "asm_backup_files", "asm_changes",
    "asm_repo_findings", "asm_saas_apps", "asm_user_accounts",
]
# Parent tables: org_id comes from the owner's member_profile (user_id → org).
_PARENT_TABLES = ["asm_discoveries", "assets"]

_ALL = _PARENT_TABLES + _CHILD_TABLES


def _has_table(bind, name: str) -> bool:
    return sa.inspect(bind).has_table(name)


def _null_count(bind, table: str) -> int:
    return bind.execute(
        sa.text(f"SELECT COUNT(*) FROM {table} WHERE org_id IS NULL")
    ).scalar() or 0


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Parent backfill from member_profiles (via user_id).
    for tbl in _PARENT_TABLES:
        if _has_table(bind, tbl) and _has_table(bind, "member_profiles"):
            bind.execute(sa.text(f"""
                UPDATE {tbl} t SET org_id = mp.org_id
                FROM member_profiles mp
                WHERE t.org_id IS NULL
                  AND mp.supabase_user_id = t.user_id
                  AND mp.deleted_at IS NULL
            """))

    # 2) Child backfill from the parent discovery.
    for tbl in _CHILD_TABLES:
        if _has_table(bind, tbl) and _has_table(bind, "asm_discoveries"):
            bind.execute(sa.text(f"""
                UPDATE {tbl} c SET org_id = d.org_id
                FROM asm_discoveries d
                WHERE c.org_id IS NULL
                  AND c.asm_discovery_id = d.id
                  AND d.org_id IS NOT NULL
            """))

    # 3) Enforce NOT NULL only where fully backfilled.
    for tbl in _ALL:
        if not _has_table(bind, tbl):
            continue
        remaining = _null_count(bind, tbl)
        if remaining == 0:
            op.alter_column(tbl, "org_id", existing_type=sa.String(), nullable=False)
        else:
            # Leave nullable; surface the gap so it can be cleaned and re-run.
            op.execute(sa.text(
                f"DO $$ BEGIN RAISE NOTICE "
                f"'org_id NOT NULL skipped for {tbl}: % rows still NULL', "
                f"(SELECT COUNT(*) FROM {tbl} WHERE org_id IS NULL); END $$;"
            ))


def downgrade() -> None:
    bind = op.get_bind()
    for tbl in _ALL:
        if _has_table(bind, tbl):
            op.alter_column(tbl, "org_id", existing_type=sa.String(), nullable=True)

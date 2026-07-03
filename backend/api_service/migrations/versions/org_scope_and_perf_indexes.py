"""tenant-scope hardening + hot-path performance indexes

What this does (all additive + reversible; no data loss):
  1. Adds a nullable, indexed org_id to billing tables (subscriptions, invoices)
     so billing can be tenant-scoped/reported per org.
  2. Backfills org_id on ASM child tables from their parent discovery
     (asm_*.org_id := asm_discoveries.org_id via asm_discovery_id) where NULL.
  3. Adds performance indexes behind real hot-path predicates:
       - ix_assets_org_risk (org_id, risk_score DESC)   -> dashboard ORDER BY / buckets
       - ix_asm_disc_nextrun (next_run_at)               -> scheduler 60s due poll
       - ix_asm_disc_status  (status)                    -> reaper + status filters

NOT enforced here on purpose: setting org_id NOT NULL. That requires verifying
ZERO NULLs first (a discovery/asset with a genuinely NULL org_id is orphaned data
that needs manual triage). After running this migration, confirm:
    SELECT count(*) FROM asm_discoveries WHERE org_id IS NULL;   -- must be 0
    SELECT count(*) FROM assets          WHERE org_id IS NULL;   -- must be 0
then add a follow-up migration doing op.alter_column(..., nullable=False) per table.

Revision ID: org_scope_and_perf_indexes
Revises: assets_ownership_verif
Create Date: 2026-07-03
"""
import sqlalchemy as sa
from alembic import op

revision = "org_scope_and_perf_indexes"
down_revision = "assets_ownership_verif"
branch_labels = None
depends_on = None

_ASM_CHILD_TABLES = [
    "asm_subdomains", "asm_ips", "asm_ports", "asm_services", "asm_ssl_certs",
    "asm_api_endpoints", "asm_admin_endpoints", "asm_backup_files",
    "asm_cloud_resources", "asm_changes", "asm_saas_apps",
    "asm_repo_findings", "asm_user_accounts",
]


def _has_table(name: str) -> bool:
    return op.get_bind().execute(sa.text("SELECT to_regclass(:n)"), {"n": name}).scalar() is not None


def _has_column(table: str, col: str) -> bool:
    return op.get_bind().execute(
        sa.text("SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"),
        {"t": table, "c": col},
    ).first() is not None


def upgrade() -> None:
    # 1) billing org_id (+ FK to organizations, matching the model). Safe: the
    #    column is nullable and left NULL here, so the FK has no rows to violate.
    for tbl in ("subscriptions", "invoices"):
        if _has_table(tbl) and not _has_column(tbl, "org_id"):
            op.add_column(tbl, sa.Column("org_id", sa.String(), nullable=True))
            op.create_index(f"ix_{tbl}_org_id", tbl, ["org_id"])
            if _has_table("organizations"):
                op.create_foreign_key(
                    f"fk_{tbl}_org_id", tbl, "organizations",
                    ["org_id"], ["id"], ondelete="CASCADE",
                )

    # 2) backfill ASM child org_id from parent discovery (idempotent: WHERE NULL)
    for tbl in _ASM_CHILD_TABLES:
        if _has_table(tbl) and _has_column(tbl, "org_id") and _has_column(tbl, "asm_discovery_id"):
            op.execute(sa.text(
                f"UPDATE {tbl} AS c SET org_id = d.org_id "
                f"FROM asm_discoveries d WHERE c.asm_discovery_id = d.id AND c.org_id IS NULL"
            ))

    # 3) hot-path indexes (guarded; CREATE INDEX IF NOT EXISTS is Postgres-native)
    if _has_table("assets"):
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_assets_org_risk ON assets (org_id, risk_score DESC)"))
    if _has_table("asm_discoveries"):
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_asm_disc_nextrun ON asm_discoveries (next_run_at)"))
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_asm_disc_status ON asm_discoveries (status)"))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_asm_disc_status"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_asm_disc_nextrun"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_assets_org_risk"))
    # org_id backfill is data-only; leaving values in place on downgrade is safe.
    for tbl in ("subscriptions", "invoices"):
        if _has_table(tbl) and _has_column(tbl, "org_id"):
            op.execute(sa.text(f"ALTER TABLE {tbl} DROP CONSTRAINT IF EXISTS fk_{tbl}_org_id"))
            op.execute(sa.text(f"DROP INDEX IF EXISTS ix_{tbl}_org_id"))
            op.drop_column(tbl, "org_id")

"""create asm_repo_findings, asm_saas_apps, asm_user_accounts tables

Storage for the repo / saas / user ASM asset types.

Revision ID: asm_user_repo_saas
Revises: asm_unique_per_discovery
Create Date: 2026-06-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "asm_user_repo_saas"
down_revision = "asm_unique_per_discovery"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    # Idempotent: app startup create_all may have already made these tables.
    return op.get_bind().execute(
        sa.text("SELECT to_regclass(:n)"), {"n": name}
    ).scalar() is not None


def upgrade() -> None:
    if not _has_table("asm_repo_findings"):
        op.create_table(
            "asm_repo_findings",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("asm_discovery_id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=True),
            sa.Column("asset_id", sa.String(), nullable=False),
            sa.Column("repo_url", sa.String(), nullable=False),
            sa.Column("finding_type", sa.String(), nullable=True),
            sa.Column("rule", sa.String(), nullable=True),
            sa.Column("severity", sa.String(), nullable=True),
            sa.Column("file_path", sa.String(), nullable=True),
            sa.Column("line", sa.Integer(), nullable=True),
            sa.Column("secret", sa.String(), nullable=True),
            sa.Column("commit", sa.String(), nullable=True),
            sa.Column("extra_info", postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
            sa.ForeignKeyConstraint(["asm_discovery_id"], ["asm_discoveries.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("asm_discovery_id", "repo_url", "rule", "file_path", "line", name="uq_repo_finding"),
        )
        op.create_index("ix_asm_repo_findings_asm_discovery_id", "asm_repo_findings", ["asm_discovery_id"])
        op.create_index("ix_asm_repo_findings_org_id", "asm_repo_findings", ["org_id"])
        op.create_index("ix_asm_repo_findings_asset_id", "asm_repo_findings", ["asset_id"])

    if not _has_table("asm_saas_apps"):
        op.create_table(
            "asm_saas_apps",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("asm_discovery_id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=True),
            sa.Column("asset_id", sa.String(), nullable=False),
            sa.Column("app_name", sa.String(), nullable=False),
            sa.Column("vendor", sa.String(), nullable=True),
            sa.Column("category", sa.String(), nullable=True),
            sa.Column("url", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("discovery_method", sa.String(), nullable=True),
            sa.Column("extra_info", postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
            sa.ForeignKeyConstraint(["asm_discovery_id"], ["asm_discoveries.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("asm_discovery_id", "app_name", name="uq_saas_app"),
        )
        op.create_index("ix_asm_saas_apps_asm_discovery_id", "asm_saas_apps", ["asm_discovery_id"])
        op.create_index("ix_asm_saas_apps_org_id", "asm_saas_apps", ["org_id"])
        op.create_index("ix_asm_saas_apps_asset_id", "asm_saas_apps", ["asset_id"])

    if not _has_table("asm_user_accounts"):
        op.create_table(
            "asm_user_accounts",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("asm_discovery_id", sa.String(), nullable=False),
            sa.Column("org_id", sa.String(), nullable=True),
            sa.Column("asset_id", sa.String(), nullable=False),
            sa.Column("email", sa.String(), nullable=False),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("breached", sa.Boolean(), nullable=True),
            sa.Column("breach_count", sa.Integer(), nullable=True),
            sa.Column("exposed_data", postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column("severity", sa.String(), nullable=True),
            sa.Column("extra_info", postgresql.JSON(astext_type=sa.Text()), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
            sa.ForeignKeyConstraint(["asm_discovery_id"], ["asm_discoveries.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("asm_discovery_id", "email", "source", name="uq_user_account"),
        )
        op.create_index("ix_asm_user_accounts_asm_discovery_id", "asm_user_accounts", ["asm_discovery_id"])
        op.create_index("ix_asm_user_accounts_org_id", "asm_user_accounts", ["org_id"])
        op.create_index("ix_asm_user_accounts_asset_id", "asm_user_accounts", ["asset_id"])


def downgrade() -> None:
    op.drop_table("asm_user_accounts")
    op.drop_table("asm_saas_apps")
    op.drop_table("asm_repo_findings")

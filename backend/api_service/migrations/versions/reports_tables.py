"""create reports + scheduled_reports tables

Org-scoped report artifacts (content computed from real tenant data) and
recurring report schedules.

Revision ID: reports_tables
Revises: assets_risk_nullable
Create Date: 2026-06-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision = "reports_tables"
down_revision = "assets_risk_nullable"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    # The app's Base.metadata.create_all may have already created these tables
    # at startup; skip creation so this migration is idempotent.
    return inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if _has_table("reports"):
        return
    op.create_table(
        "reports",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=True),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("module", sa.String(length=20), nullable=False, server_default="all"),
        sa.Column("report_type", sa.String(length=50), nullable=False),
        sa.Column("format", sa.String(length=10), nullable=False, server_default="pdf"),
        sa.Column("date_range", sa.String(length=20), nullable=True),
        sa.Column("sections", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ready"),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reports_org_id", "reports", ["org_id"])
    op.create_index("ix_reports_user_id", "reports", ["user_id"])

    op.create_table(
        "scheduled_reports",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=True),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("module", sa.String(length=20), nullable=False, server_default="all"),
        sa.Column("report_type", sa.String(length=50), nullable=False),
        sa.Column("format", sa.String(length=10), nullable=False, server_default="pdf"),
        sa.Column("frequency", sa.String(length=20), nullable=False, server_default="weekly"),
        sa.Column("recipients", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scheduled_reports_org_id", "scheduled_reports", ["org_id"])
    op.create_index("ix_scheduled_reports_user_id", "scheduled_reports", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_scheduled_reports_user_id", table_name="scheduled_reports")
    op.drop_index("ix_scheduled_reports_org_id", table_name="scheduled_reports")
    op.drop_table("scheduled_reports")
    op.drop_index("ix_reports_user_id", table_name="reports")
    op.drop_index("ix_reports_org_id", table_name="reports")
    op.drop_table("reports")

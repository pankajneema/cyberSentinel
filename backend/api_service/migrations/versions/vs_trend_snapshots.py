"""VS trend snapshots — daily per-org severity history for trend charts."""
from alembic import op
import sqlalchemy as sa

revision = "vs_trend_snapshots"
down_revision = "vs_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vs_trend_snapshots",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_date", sa.String(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("critical", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("high", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("medium", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("low", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kev", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("open_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("remediated_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("org_id", "snapshot_date", name="uq_vs_trend_org_day"),
    )
    op.create_index("ix_vs_trend_snapshots_org_id", "vs_trend_snapshots", ["org_id"])


def downgrade() -> None:
    op.drop_table("vs_trend_snapshots")

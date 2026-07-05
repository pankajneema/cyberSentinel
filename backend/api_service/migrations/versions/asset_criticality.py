"""Add assets.criticality (business context) — feeds the exposure/VS risk score."""
from alembic import op
import sqlalchemy as sa

revision = "asset_criticality"
down_revision = "vs_trend_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assets", sa.Column("criticality", sa.String(length=20),
                                      nullable=False, server_default="normal"))


def downgrade() -> None:
    op.drop_column("assets", "criticality")

"""make assets.risk_score nullable (Unscanned) + add last_scored_at

Risk score is now computed from real ASM scan data by scoring/exposure.py.
A NULL risk_score means the asset has never been scored ("Unscanned" in the UI),
which is meaningfully different from a real computed score of 0 (severity "info").
Existing rows defaulted to 0 were never actually scored, so they are reset to NULL.

Revision ID: assets_risk_nullable
Revises: drop_user_fks
Create Date: 2026-06-27
"""
import sqlalchemy as sa
from alembic import op

revision = "assets_risk_nullable"
down_revision = "drop_user_fks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column("last_scored_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("assets", "risk_score", existing_type=sa.Integer(), nullable=True)
    # Default-0 rows were never scored -> mark them Unscanned.
    op.execute("UPDATE assets SET risk_score = NULL WHERE risk_score = 0")


def downgrade() -> None:
    op.execute("UPDATE assets SET risk_score = 0 WHERE risk_score IS NULL")
    op.alter_column(
        "assets", "risk_score", existing_type=sa.Integer(), nullable=False,
        server_default="0",
    )
    op.drop_column("assets", "last_scored_at")

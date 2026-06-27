"""add assets.ownership_verified + verification_token (authorization-to-scan)

Active discoveries (NORMAL/DEEP) require a verified-owned target so the platform
cannot be used to actively scan third-party infrastructure.

Revision ID: assets_ownership_verif
Revises: asm_user_repo_saas
Create Date: 2026-06-28
"""
import sqlalchemy as sa
from alembic import op

revision = "assets_ownership_verif"
down_revision = "asm_user_repo_saas"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    return op.get_bind().execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": column},
    ).scalar() is not None


def upgrade() -> None:
    if not _has_column("assets", "ownership_verified"):
        op.add_column(
            "assets",
            sa.Column("ownership_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if not _has_column("assets", "verification_token"):
        op.add_column("assets", sa.Column("verification_token", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("assets", "verification_token")
    op.drop_column("assets", "ownership_verified")

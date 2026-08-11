"""assets.risk_factors — persist the explainable score breakdown

Asset.risk_score has always been persisted, but the per-factor breakdown
(scoring/exposure.py's ExposureScore.factors) was computed fresh on every
/rescore call and the scheduler's auto-score pass, then discarded — never
written to the DB. The result: the frontend's "Why this score" panel only
ever showed data for an asset the user had personally clicked "Rescore" on
in the current browser session; every asset scored by the scheduler (the
default path) had no explanation available at all, despite the scoring
engine's own design principles promising explainability. This column closes
that gap; routes/assets.py and asm/service.py now write to it alongside
risk_score.

Revision ID: asset_risk_factors
Revises: local_auth_migration
Create Date: 2026-08-11
"""
import sqlalchemy as sa
from alembic import op

revision = "asset_risk_factors"
down_revision = "local_auth_migration"
branch_labels = None
depends_on = None


def _has_column(table: str, col: str) -> bool:
    return op.get_bind().execute(
        sa.text("SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"),
        {"t": table, "c": col},
    ).first() is not None


def upgrade() -> None:
    if not _has_column("assets", "risk_factors"):
        op.add_column("assets", sa.Column("risk_factors", sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column("assets", "risk_factors"):
        op.drop_column("assets", "risk_factors")

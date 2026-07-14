"""add ADMITTED and CANCELLED to the asm_run_status enum

Part of the ASM/VS/CA scan-execution redesign: the unified task lifecycle is
PENDING → ADMITTED → RUNNING → COMPLETED | FAILED | CANCELLED. The
asm_run_status Postgres enum previously had only PENDING/RUNNING/COMPLETED/FAILED,
so writing ADMITTED or CANCELLED would fail. vs_scan_runs.status is a plain
String and already tolerates these values, so no VS change is needed here.

Revision ID: scan_redesign_task_states
Revises: ca_fixes
Create Date: 2026-07-09
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "scan_redesign_task_states"
down_revision = "ca_fixes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so use an
    # autocommit block. IF NOT EXISTS makes the migration idempotent/re-runnable.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE asm_run_status ADD VALUE IF NOT EXISTS 'ADMITTED'")
        op.execute("ALTER TYPE asm_run_status ADD VALUE IF NOT EXISTS 'CANCELLED'")


def downgrade() -> None:
    # PostgreSQL cannot remove a value from an enum type, so the downgrade is a
    # no-op (the extra enum labels are harmless if unused).
    pass

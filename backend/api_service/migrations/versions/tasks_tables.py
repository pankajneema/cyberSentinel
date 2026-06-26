"""create tasks + task_messages tables

Org-scoped team tasks (remediation/assignments) and their message threads.

Revision ID: tasks_tables
Revises: notifications
Create Date: 2026-06-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "tasks_tables"
down_revision = "notifications"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    # Idempotent: app startup create_all may have already made these tables.
    return inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if _has_table("tasks"):
        return
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=True),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("assignee_id", sa.String(), nullable=True),
        sa.Column("assignee_name", sa.String(length=255), nullable=True),
        sa.Column("due_date", sa.String(), nullable=True),
        sa.Column("completed_at", sa.String(), nullable=True),
        sa.Column("asset_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_org_id", "tasks", ["org_id"])
    op.create_index("ix_tasks_user_id", "tasks", ["user_id"])

    op.create_table(
        "task_messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("org_id", sa.String(), nullable=True),
        sa.Column("sender", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("platform", sa.String(length=20), nullable=False, server_default="internal"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_messages_task_id", "task_messages", ["task_id"])
    op.create_index("ix_task_messages_org_id", "task_messages", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_task_messages_org_id", table_name="task_messages")
    op.drop_index("ix_task_messages_task_id", table_name="task_messages")
    op.drop_table("task_messages")
    op.drop_index("ix_tasks_user_id", table_name="tasks")
    op.drop_index("ix_tasks_org_id", table_name="tasks")
    op.drop_table("tasks")

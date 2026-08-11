"""replace Supabase auth with self-hosted DB auth

Supabase (the previous identity provider) is gone -- its project was deleted
and DNS no longer resolves it. This migration:

  1. Drops the DEAD legacy auth schema (companies/users/profiles/team_invites/
     team_roles/user_settings from models/auth_models.py) -- confirmed unused
     by any mounted route (test_routes_security.py asserts as much), and the
     name collision with the new `users` table below is exactly why this must
     run first, in the same migration.
  2. Creates the new self-hosted identity tables: users, oauth_identities,
     refresh_tokens, password_reset_tokens.
  3. Renames member_profiles.supabase_user_id -> user_id (and the same on
     member_settings) now that "supabase" no longer describes anything in
     this codebase.
  4. Backfills a placeholder `users` row for any pre-existing member_profiles
     row left over from the dead Supabase project, so the FK added in step 5
     doesn't orphan real org data. Those accounts have no password and no
     OAuth link -- they regain access via "forgot password" or by signing up
     with matching-email OAuth (which auto-links).
  5. Adds FK member_profiles.user_id -> users.id (and same on member_settings).

Revision ID: local_auth_migration
Revises: scan_redesign_task_states
Create Date: 2026-08-11
"""
import sqlalchemy as sa
from alembic import op

revision = "local_auth_migration"
down_revision = "scan_redesign_task_states"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return op.get_bind().execute(sa.text("SELECT to_regclass(:n)"), {"n": name}).scalar() is not None


def _has_column(table: str, col: str) -> bool:
    return op.get_bind().execute(
        sa.text("SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"),
        {"t": table, "c": col},
    ).first() is not None


_LEGACY_TABLES_CHILD_FIRST = [
    "team_invites", "team_roles", "user_settings", "profiles", "companies", "users",
]


def upgrade() -> None:
    for tbl in _LEGACY_TABLES_CHILD_FIRST:
        if _has_table(tbl):
            op.execute(sa.text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))

    if not _has_table("users"):
        op.create_table(
            "users",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("email", sa.String(), nullable=False),
            sa.Column("password_hash", sa.String(), nullable=True),
            sa.Column("full_name", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.Column("last_login_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_users_email", "users", ["email"], unique=True)

    if not _has_table("oauth_identities"):
        op.create_table(
            "oauth_identities",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("provider", sa.String(), nullable=False),
            sa.Column("provider_user_id", sa.String(), nullable=False),
            sa.Column("email", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("provider", "provider_user_id", name="uq_oauth_provider_identity"),
        )
        op.create_index("ix_oauth_identities_user_id", "oauth_identities", ["user_id"], unique=False)

    if not _has_table("refresh_tokens"):
        op.create_table(
            "refresh_tokens",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
        op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False)

    if not _has_table("password_reset_tokens"):
        op.create_table(
            "password_reset_tokens",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
        op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"], unique=False)

    if _has_table("member_profiles") and _has_column("member_profiles", "supabase_user_id"):
        op.alter_column("member_profiles", "supabase_user_id", new_column_name="user_id")
        op.execute(sa.text(
            "ALTER INDEX IF EXISTS ix_member_profiles_supabase_user_id "
            "RENAME TO ix_member_profiles_user_id"
        ))
    if _has_table("member_settings") and _has_column("member_settings", "supabase_user_id"):
        op.alter_column("member_settings", "supabase_user_id", new_column_name="user_id")
        op.execute(sa.text(
            "ALTER INDEX IF EXISTS ix_member_settings_supabase_user_id "
            "RENAME TO ix_member_settings_user_id"
        ))

    if _has_table("member_profiles"):
        # Same real person can have signed up more than once against the dead
        # Supabase project (different `sub` each time), leaving >1
        # member_profiles row on the same email -- e.g. one person owning two
        # separate orgs from two separate signups. `users.email` is unique (it
        # IS the login identity now), so those rows must consolidate onto one
        # canonical account rather than each minting their own `users` row
        # (which would violate the unique-email constraint on the second one).
        # Canonical = the user_id from that email's earliest member_profiles
        # row; every row on that email (both member_profiles and its
        # member_settings) gets re-pointed at it, so the person keeps
        # ownership of every org they'd already created, now under one login.
        op.execute(sa.text(
            "CREATE TEMP TABLE _canonical_user_map AS "
            "SELECT DISTINCT ON (email) email, user_id AS canonical_user_id, full_name "
            "FROM member_profiles ORDER BY email, created_at ASC"
        ))
        op.execute(sa.text(
            """
            INSERT INTO users (id, email, full_name, created_at, updated_at)
            SELECT c.canonical_user_id, c.email, c.full_name, now(), now()
            FROM _canonical_user_map c
            LEFT JOIN users u ON u.id = c.canonical_user_id
            WHERE u.id IS NULL
            ON CONFLICT (id) DO NOTHING
            """
        ))
        if _has_table("member_settings"):
            op.execute(sa.text(
                """
                UPDATE member_settings ms
                SET user_id = c.canonical_user_id
                FROM member_profiles mp
                JOIN _canonical_user_map c ON c.email = mp.email
                WHERE ms.user_id = mp.user_id AND ms.org_id = mp.org_id
                  AND mp.user_id <> c.canonical_user_id
                """
            ))
        op.execute(sa.text(
            """
            UPDATE member_profiles mp
            SET user_id = c.canonical_user_id
            FROM _canonical_user_map c
            WHERE mp.email = c.email AND mp.user_id <> c.canonical_user_id
            """
        ))
        op.execute(sa.text("DROP TABLE _canonical_user_map"))

    if _has_table("member_profiles"):
        op.create_foreign_key(
            "fk_member_profiles_user_id", "member_profiles", "users",
            ["user_id"], ["id"], ondelete="CASCADE",
        )
    if _has_table("member_settings"):
        op.create_foreign_key(
            "fk_member_settings_user_id", "member_settings", "users",
            ["user_id"], ["id"], ondelete="CASCADE",
        )


def downgrade() -> None:
    # Reverse the rename/new-tables. Does NOT resurrect the dropped legacy
    # tables (data-destructive drop; same precedent as drop_user_fks.py's
    # intentionally incomplete downgrade).
    if _has_table("member_settings"):
        op.execute(sa.text("ALTER TABLE member_settings DROP CONSTRAINT IF EXISTS fk_member_settings_user_id"))
    if _has_table("member_profiles"):
        op.execute(sa.text("ALTER TABLE member_profiles DROP CONSTRAINT IF EXISTS fk_member_profiles_user_id"))

    if _has_table("member_settings") and _has_column("member_settings", "user_id"):
        op.execute(sa.text(
            "ALTER INDEX IF EXISTS ix_member_settings_user_id RENAME TO ix_member_settings_supabase_user_id"
        ))
        op.alter_column("member_settings", "user_id", new_column_name="supabase_user_id")
    if _has_table("member_profiles") and _has_column("member_profiles", "user_id"):
        op.execute(sa.text(
            "ALTER INDEX IF EXISTS ix_member_profiles_user_id RENAME TO ix_member_profiles_supabase_user_id"
        ))
        op.alter_column("member_profiles", "user_id", new_column_name="supabase_user_id")

    for tbl in ("password_reset_tokens", "refresh_tokens", "oauth_identities", "users"):
        op.execute(sa.text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))

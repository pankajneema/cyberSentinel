"""CA audit-remediation fixes.

1. ca_audit_trail.seq — monotonic identity column so the hash chain has a
   deterministic order (uuid PKs and microsecond timestamps do not).
2. ca_evidence_guard v2 — same immutability, plus a session-scoped escape
   hatch so ORGANIZATION DELETION can cascade:
       SET LOCAL cybersentinel.ca_allow_delete = 'on';
   Only DELETE honors the flag (content immutability is never relaxed), and
   SET LOCAL scopes it to the surrounding transaction.

Revision ID: ca_fixes
Revises: ca_module
"""

from alembic import op
import sqlalchemy as sa

revision = "ca_fixes"
down_revision = "ca_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE ca_audit_trail ADD COLUMN seq BIGINT GENERATED ALWAYS AS IDENTITY"
    )
    op.create_index("ix_ca_audit_trail_seq", "ca_audit_trail", ["seq"])
    op.create_index("ix_ca_trail_org_seq", "ca_audit_trail", ["org_id", "seq"])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION ca_evidence_guard() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF current_setting('cybersentinel.ca_allow_delete', true) = 'on' THEN
                    RETURN OLD;   -- org-offboarding cascade only
                END IF;
                RAISE EXCEPTION 'ca_evidence is append-only (revoke instead of delete)';
            END IF;
            IF NEW.id IS DISTINCT FROM OLD.id
               OR NEW.org_id IS DISTINCT FROM OLD.org_id
               OR NEW.check_id IS DISTINCT FROM OLD.check_id
               OR NEW.collection IS DISTINCT FROM OLD.collection
               OR NEW.source_type IS DISTINCT FROM OLD.source_type
               OR NEW.source_ref::text IS DISTINCT FROM OLD.source_ref::text
               OR NEW.summary IS DISTINCT FROM OLD.summary
               OR NEW.content::text IS DISTINCT FROM OLD.content::text
               OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
               OR NEW.result IS DISTINCT FROM OLD.result
               OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
               OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
               OR NEW.file_id IS DISTINCT FROM OLD.file_id
            THEN
                RAISE EXCEPTION 'ca_evidence content is immutable; only lifecycle status may change';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    # ca_evidence_files rows are FK-cascade targets of evidence/attestations and
    # carry the encrypted blobs; org deletion cascades them without a trigger.


def downgrade() -> None:
    op.drop_index("ix_ca_trail_org_seq", table_name="ca_audit_trail")
    op.drop_index("ix_ca_audit_trail_seq", table_name="ca_audit_trail")
    op.execute("ALTER TABLE ca_audit_trail DROP COLUMN seq")
    # restore the v1 guard (no escape hatch)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION ca_evidence_guard() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'ca_evidence is append-only (revoke instead of delete)';
            END IF;
            IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
                RAISE EXCEPTION 'ca_evidence content is immutable';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )

"""CA (Compliance & Audit) module tables.

Creates the framework/control catalog, canonical checks layer, evidence
(append-only, hash-stamped), control states, posture snapshots, gaps +
history, policies, audits/auditor grants, and the hash-chained CA audit
trail.

Immutability is DB-enforced with triggers (owner-proof, unlike REVOKE):
  - ca_audit_trail: UPDATE/DELETE always raise.
  - ca_evidence: DELETE raises; UPDATE may only change status /
    revoke_justification (lifecycle), never content/hash/source.

Revision ID: ca_module
Revises: asset_criticality
"""

from alembic import op
import sqlalchemy as sa

revision = "ca_module"
down_revision = "asset_criticality"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- catalog -----------------------------------------------------------
    op.create_table(
        "ca_frameworks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("authority", sa.String(), nullable=True),
        sa.Column("region", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_reference", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("source_checksum", sa.String(), nullable=True),
        sa.Column("loaded_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.UniqueConstraint("key", "version", name="uq_ca_framework_key_version"),
    )

    op.create_table(
        "ca_controls",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("framework_id", sa.String(), sa.ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("control_ref", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("criticality", sa.String(), nullable=False, server_default="medium"),
        sa.Column("control_type", sa.String(), nullable=False, server_default="technical"),
        sa.Column("evidence_guidance", sa.Text(), nullable=True),
        sa.UniqueConstraint("framework_id", "control_ref", name="uq_ca_control_ref"),
    )
    op.create_index("ix_ca_controls_framework_id", "ca_controls", ["framework_id"])
    op.create_index("ix_ca_controls_fw_cat", "ca_controls", ["framework_id", "category"])

    op.create_table(
        "ca_checks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("key", sa.String(), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("collection", sa.String(), nullable=False, server_default="automated"),
        sa.Column("logic_key", sa.String(), nullable=True),
        sa.Column("logic_params", sa.JSON(), nullable=True),
        sa.Column("source_type", sa.String(), nullable=True),
        sa.Column("freshness_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("collection IN ('automated','manual')", name="ck_ca_checks_collection"),
    )

    op.create_table(
        "ca_control_check_map",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("control_id", sa.String(), sa.ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("check_id", sa.String(), sa.ForeignKey("ca_checks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.UniqueConstraint("control_id", "check_id", name="uq_ca_ctrl_check"),
    )
    op.create_index("ix_ca_ccm_control_id", "ca_control_check_map", ["control_id"])
    op.create_index("ix_ca_ccm_check_id", "ca_control_check_map", ["check_id"])

    # -- enablement --------------------------------------------------------
    op.create_table(
        "ca_org_frameworks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("framework_id", sa.String(), sa.ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("target_date", sa.DateTime(), nullable=True),
        sa.Column("enabled_by", sa.String(), nullable=True),
        sa.Column("next_eval_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.UniqueConstraint("org_id", "framework_id", name="uq_ca_org_fw"),
    )
    op.create_index("ix_ca_org_frameworks_org_id", "ca_org_frameworks", ["org_id"])
    op.create_index("ix_ca_org_frameworks_next_eval_at", "ca_org_frameworks", ["next_eval_at"])

    # -- evidence ----------------------------------------------------------
    op.create_table(
        "ca_evidence_files",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_by", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("ix_ca_evidence_files_org_id", "ca_evidence_files", ["org_id"])

    op.create_table(
        "ca_evidence",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("check_id", sa.String(), sa.ForeignKey("ca_checks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("collection", sa.String(), nullable=False),
        sa.Column("source_type", sa.String(), nullable=False),
        sa.Column("source_ref", sa.JSON(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("content", sa.JSON(), nullable=True),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("result", sa.String(), nullable=True),
        sa.Column("captured_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("valid_until", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="valid"),
        sa.Column("revoke_justification", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.String(), nullable=True),
        sa.Column("file_id", sa.String(), sa.ForeignKey("ca_evidence_files.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("collection IN ('automated','manual')", name="ck_ca_evidence_collection"),
    )
    for col in ("org_id", "check_id", "captured_at", "valid_until", "status"):
        op.create_index(f"ix_ca_evidence_{col}", "ca_evidence", [col])
    op.create_index("ix_ca_evidence_org_check", "ca_evidence", ["org_id", "check_id", "status"])

    op.create_table(
        "ca_evidence_control_links",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evidence_id", sa.String(), sa.ForeignKey("ca_evidence.id", ondelete="CASCADE"), nullable=False),
        sa.Column("control_id", sa.String(), sa.ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("evidence_id", "control_id", name="uq_ca_ev_ctrl"),
    )
    op.create_index("ix_ca_ecl_org_id", "ca_evidence_control_links", ["org_id"])
    op.create_index("ix_ca_ecl_evidence_id", "ca_evidence_control_links", ["evidence_id"])
    op.create_index("ix_ca_ecl_control_id", "ca_evidence_control_links", ["control_id"])

    # -- state & posture ----------------------------------------------------
    op.create_table(
        "ca_control_states",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("control_id", sa.String(), sa.ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("computed_at", sa.DateTime(), nullable=True),
        sa.Column("computed_from", sa.JSON(), nullable=True),
        sa.Column("na_justification", sa.Text(), nullable=True),
        sa.Column("na_scope", sa.Text(), nullable=True),
        sa.Column("na_set_by", sa.String(), nullable=True),
        sa.Column("na_set_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("org_id", "control_id", name="uq_ca_state"),
        sa.CheckConstraint(
            "status IN ('satisfied','partial','gap','not_applicable','unknown')",
            name="ck_ca_state_status",
        ),
    )
    op.create_index("ix_ca_control_states_org_id", "ca_control_states", ["org_id"])
    op.create_index("ix_ca_control_states_control_id", "ca_control_states", ["control_id"])
    op.create_index("ix_ca_state_org_status", "ca_control_states", ["org_id", "status"])

    op.create_table(
        "ca_posture_snapshots",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("framework_id", sa.String(), sa.ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_date", sa.String(), nullable=False),
        sa.Column("satisfied", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("partial", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("gap", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("not_applicable", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unknown", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.UniqueConstraint("org_id", "framework_id", "snapshot_date", name="uq_ca_snap"),
    )
    op.create_index("ix_ca_posture_snapshots_org_id", "ca_posture_snapshots", ["org_id"])
    op.create_index("ix_ca_posture_snapshots_framework_id", "ca_posture_snapshots", ["framework_id"])

    # -- gaps ----------------------------------------------------------------
    op.create_table(
        "ca_gaps",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("control_id", sa.String(), sa.ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dedup_key", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("missing", sa.JSON(), nullable=True),
        sa.Column("severity", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("assigned_to", sa.String(), nullable=True),
        sa.Column("sla_due_at", sa.DateTime(), nullable=True),
        sa.Column("first_detected_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("last_detected_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    for col in ("org_id", "control_id", "dedup_key", "severity", "status", "sla_due_at"):
        op.create_index(f"ix_ca_gaps_{col}", "ca_gaps", [col])
    op.create_index("ix_ca_gaps_org_status_sev", "ca_gaps", ["org_id", "status", "severity"])

    op.create_table(
        "ca_gap_history",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("gap_id", sa.String(), sa.ForeignKey("ca_gaps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(), nullable=True),
        sa.Column("to_status", sa.String(), nullable=False),
        sa.Column("actor_user_id", sa.String(), nullable=True),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.Column("at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("ix_ca_gap_history_gap_id", "ca_gap_history", ["gap_id"])
    op.create_index("ix_ca_gap_history_org_id", "ca_gap_history", ["org_id"])
    op.create_index("ix_ca_gap_history_at", "ca_gap_history", ["at"])

    # -- policies -------------------------------------------------------------
    op.create_table(
        "ca_policies",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("key", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("current_version_id", sa.String(), nullable=True),
        sa.Column("owner_user_id", sa.String(), nullable=True),
        sa.Column("review_frequency_days", sa.Integer(), nullable=False, server_default="365"),
        sa.Column("next_review_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("ix_ca_policies_org_id", "ca_policies", ["org_id"])

    op.create_table(
        "ca_policy_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("policy_id", sa.String(), sa.ForeignKey("ca_policies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("body_md", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("published_by", sa.String(), nullable=True),
        sa.Column("published_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.UniqueConstraint("policy_id", "version", name="uq_ca_policy_ver"),
    )
    op.create_index("ix_ca_policy_versions_policy_id", "ca_policy_versions", ["policy_id"])

    op.create_table(
        "ca_policy_acks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("policy_version_id", sa.String(), sa.ForeignKey("ca_policy_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_user_id", sa.String(), nullable=False),
        sa.Column("acked_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.UniqueConstraint("policy_version_id", "member_user_id", name="uq_ca_ack"),
    )
    op.create_index("ix_ca_policy_acks_org_id", "ca_policy_acks", ["org_id"])
    op.create_index("ix_ca_policy_acks_policy_version_id", "ca_policy_acks", ["policy_version_id"])

    # -- audits ---------------------------------------------------------------
    op.create_table(
        "ca_audits",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("framework_id", sa.String(), sa.ForeignKey("ca_frameworks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("audit_firm", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="preparation"),
        sa.Column("period_start", sa.DateTime(), nullable=True),
        sa.Column("period_end", sa.DateTime(), nullable=True),
        sa.Column("scope", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("ix_ca_audits_org_id", "ca_audits", ["org_id"])

    op.create_table(
        "ca_auditor_grants",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("audit_id", sa.String(), sa.ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("auditor_email", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("last_access_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_ca_auditor_grants_org_id", "ca_auditor_grants", ["org_id"])
    op.create_index("ix_ca_auditor_grants_audit_id", "ca_auditor_grants", ["audit_id"])
    op.create_index("ix_ca_auditor_grants_token_hash", "ca_auditor_grants", ["token_hash"])

    op.create_table(
        "ca_audit_findings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("audit_id", sa.String(), sa.ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("control_id", sa.String(), sa.ForeignKey("ca_controls.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("raised_by_grant_id", sa.String(), sa.ForeignKey("ca_auditor_grants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("ix_ca_audit_findings_audit_id", "ca_audit_findings", ["audit_id"])
    op.create_index("ix_ca_audit_findings_org_id", "ca_audit_findings", ["org_id"])

    op.create_table(
        "ca_attestations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("audit_id", sa.String(), sa.ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(), nullable=True),
        sa.Column("valid_from", sa.DateTime(), nullable=True),
        sa.Column("valid_until", sa.DateTime(), nullable=True),
        sa.Column("file_id", sa.String(), sa.ForeignKey("ca_evidence_files.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("ix_ca_attestations_audit_id", "ca_attestations", ["audit_id"])
    op.create_index("ix_ca_attestations_org_id", "ca_attestations", ["org_id"])

    # -- immutable trail -------------------------------------------------------
    op.create_table(
        "ca_audit_trail",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), nullable=False),
        sa.Column("actor_user_id", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column("at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("prev_hash", sa.String(), nullable=True),
        sa.Column("row_hash", sa.String(), nullable=False),
    )
    op.create_index("ix_ca_audit_trail_org_id", "ca_audit_trail", ["org_id"])
    op.create_index("ix_ca_audit_trail_action", "ca_audit_trail", ["action"])
    op.create_index("ix_ca_audit_trail_at", "ca_audit_trail", ["at"])

    # DB-enforced immutability (trigger-based: effective even for the table
    # owner, unlike REVOKE). ca_audit_trail is fully append-only; ca_evidence
    # allows only the status-lifecycle columns to change after insert.
    # asyncpg forbids multi-statement execute — one statement per op.execute.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION ca_trail_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'ca_audit_trail is append-only';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_ca_trail_immutable
            BEFORE UPDATE OR DELETE ON ca_audit_trail
            FOR EACH ROW EXECUTE FUNCTION ca_trail_immutable()
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION ca_evidence_guard() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
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
    op.execute(
        """
        CREATE TRIGGER trg_ca_evidence_guard
            BEFORE UPDATE OR DELETE ON ca_evidence
            FOR EACH ROW EXECUTE FUNCTION ca_evidence_guard()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_ca_evidence_guard ON ca_evidence")
    op.execute("DROP TRIGGER IF EXISTS trg_ca_trail_immutable ON ca_audit_trail")
    op.execute("DROP FUNCTION IF EXISTS ca_evidence_guard()")
    op.execute("DROP FUNCTION IF EXISTS ca_trail_immutable()")
    for t in (
        "ca_audit_trail", "ca_attestations", "ca_audit_findings", "ca_auditor_grants",
        "ca_audits", "ca_policy_acks", "ca_policy_versions", "ca_policies",
        "ca_gap_history", "ca_gaps", "ca_posture_snapshots", "ca_control_states",
        "ca_evidence_control_links", "ca_evidence", "ca_evidence_files",
        "ca_org_frameworks", "ca_control_check_map", "ca_checks", "ca_controls",
        "ca_frameworks",
    ):
        op.drop_table(t)

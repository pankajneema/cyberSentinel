"""VS (Vulnerability Scanning) module tables.

Creates the VS data model: scan profiles/scans/runs/targets, findings + history +
remediation, CVE intel cache, and encrypted credentials. Findings FK to the
existing `assets` table (no parallel asset store). Reversible.

See docs/VS-MODULE-DESIGN.md.
"""
from alembic import op
import sqlalchemy as sa

revision = "vs_module"
down_revision = "org_id_not_null"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- encrypted credentials (referenced by profiles) ---
    op.create_table(
        "vs_credentials",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("cred_type", sa.String(), nullable=False),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("secret_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("secret_kms_key_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_vs_credentials_org_id", "vs_credentials", ["org_id"])

    # --- scan profiles ---
    op.create_table(
        "vs_scan_profiles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("intensity", sa.String(), nullable=False, server_default="standard"),
        sa.Column("engines", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("authenticated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("credential_id", sa.String(), sa.ForeignKey("vs_credentials.id", ondelete="SET NULL"), nullable=True),
        sa.Column("safe_mode", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("max_requests_per_sec", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("scan_window", sa.JSON(), nullable=True),
        sa.Column("web_scan", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_vs_scan_profiles_org_id", "vs_scan_profiles", ["org_id"])

    # --- scans (definition + schedule) ---
    op.create_table(
        "vs_scans",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("profile_id", sa.String(), sa.ForeignKey("vs_scan_profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("asset_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("schedule_type", sa.String(), nullable=False, server_default="QUICK"),
        sa.Column("schedule_value", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="PENDING"),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("last_run_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_vs_scans_org_id", "vs_scans", ["org_id"])
    op.create_index("ix_vs_scans_next_run_at", "vs_scans", ["next_run_at"])

    # --- scan runs ---
    op.create_table(
        "vs_scan_runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("scan_id", sa.String(), sa.ForeignKey("vs_scans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="PENDING"),
        sa.Column("triggered_by", sa.String(), nullable=False, server_default="schedule"),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("engine_versions", sa.JSON(), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_vs_scan_runs_scan_id", "vs_scan_runs", ["scan_id"])
    op.create_index("ix_vs_scan_runs_org_id", "vs_scan_runs", ["org_id"])
    op.create_index("ix_vs_scan_runs_created_at", "vs_scan_runs", ["created_at"])

    # --- scan targets ---
    op.create_table(
        "vs_scan_targets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("scan_run_id", sa.String(), sa.ForeignKey("vs_scan_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", sa.String(), sa.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("host", sa.String(), nullable=False),
        sa.Column("ports", sa.JSON(), nullable=True),
        sa.Column("authorized", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
    )
    op.create_index("ix_vs_scan_targets_scan_run_id", "vs_scan_targets", ["scan_run_id"])
    op.create_index("ix_vs_scan_targets_org_id", "vs_scan_targets", ["org_id"])
    op.create_index("ix_vs_scan_targets_asset_id", "vs_scan_targets", ["asset_id"])

    # --- CVE metadata (shared intel, org-agnostic) ---
    op.create_table(
        "vs_cve_metadata",
        sa.Column("cve_id", sa.String(), primary_key=True),
        sa.Column("cvss_v31_score", sa.Float(), nullable=True),
        sa.Column("cvss_v31_vector", sa.String(), nullable=True),
        sa.Column("cvss_v40_score", sa.Float(), nullable=True),
        sa.Column("cvss_v40_vector", sa.String(), nullable=True),
        sa.Column("epss_score", sa.Float(), nullable=True),
        sa.Column("epss_percentile", sa.Float(), nullable=True),
        sa.Column("kev", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("kev_date_added", sa.DateTime(), nullable=True),
        sa.Column("kev_due_date", sa.DateTime(), nullable=True),
        sa.Column("cwe_ids", sa.JSON(), nullable=True),
        sa.Column("affected_versions", sa.JSON(), nullable=True),
        sa.Column("references", sa.JSON(), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("modified_at", sa.DateTime(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_vs_cve_metadata_last_synced_at", "vs_cve_metadata", ["last_synced_at"])

    # --- findings ---
    op.create_table(
        "vs_findings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", sa.String(), sa.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scan_run_id", sa.String(), sa.ForeignKey("vs_scan_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("first_seen_run_id", sa.String(), nullable=True),
        sa.Column("dedup_key", sa.String(), nullable=False),
        sa.Column("source_engine", sa.String(), nullable=False),
        sa.Column("plugin_id", sa.String(), nullable=True),
        sa.Column("cve_id", sa.String(), sa.ForeignKey("vs_cve_metadata.cve_id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("location", sa.JSON(), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("confidence", sa.String(), nullable=False, server_default="tentative"),
        sa.Column("severity", sa.String(), nullable=False),
        sa.Column("cvss_base", sa.Float(), nullable=True),
        sa.Column("epss", sa.Float(), nullable=True),
        sa.Column("kev", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("composite_risk", sa.Integer(), nullable=True),
        sa.Column("risk_factors", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("assigned_to", sa.String(), nullable=True),
        sa.Column("sla_due_at", sa.DateTime(), nullable=True),
        sa.Column("first_detected_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("last_detected_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("org_id", "dedup_key", name="uq_vs_finding_dedup"),
    )
    op.create_index("ix_vs_findings_org_id", "vs_findings", ["org_id"])
    op.create_index("ix_vs_findings_asset_id", "vs_findings", ["asset_id"])
    op.create_index("ix_vs_findings_dedup_key", "vs_findings", ["dedup_key"])
    op.create_index("ix_vs_findings_cve_id", "vs_findings", ["cve_id"])
    op.create_index("ix_vs_findings_status", "vs_findings", ["status"])
    op.create_index("ix_vs_findings_sla_due_at", "vs_findings", ["sla_due_at"])
    op.create_index("ix_vs_findings_org_status_sev", "vs_findings", ["org_id", "status", "severity"])

    # --- finding history ---
    op.create_table(
        "vs_finding_history",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("finding_id", sa.String(), sa.ForeignKey("vs_findings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(), nullable=True),
        sa.Column("to_status", sa.String(), nullable=False),
        sa.Column("actor_user_id", sa.String(), nullable=True),
        sa.Column("justification", sa.Text(), nullable=True),
        sa.Column("at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_vs_finding_history_finding_id", "vs_finding_history", ["finding_id"])
    op.create_index("ix_vs_finding_history_org_id", "vs_finding_history", ["org_id"])
    op.create_index("ix_vs_finding_history_at", "vs_finding_history", ["at"])

    # --- remediation ---
    op.create_table(
        "vs_remediation",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("cve_id", sa.String(), nullable=True),
        sa.Column("finding_id", sa.String(), sa.ForeignKey("vs_findings.id", ondelete="CASCADE"), nullable=True),
        sa.Column("org_id", sa.String(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("fixed_version", sa.String(), nullable=True),
        sa.Column("steps", sa.JSON(), nullable=True),
        sa.Column("references", sa.JSON(), nullable=True),
        sa.Column("effort", sa.String(), nullable=True),
    )
    op.create_index("ix_vs_remediation_cve_id", "vs_remediation", ["cve_id"])


def downgrade() -> None:
    for tbl in (
        "vs_remediation", "vs_finding_history", "vs_findings", "vs_cve_metadata",
        "vs_scan_targets", "vs_scan_runs", "vs_scans", "vs_scan_profiles", "vs_credentials",
    ):
        op.drop_table(tbl)

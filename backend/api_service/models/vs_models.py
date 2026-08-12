# models/vs_models.py
#
# Vulnerability Scanning (VS) module data model.
#
# VS is a sibling of ASM: findings link to the EXISTING `assets` table (no
# parallel asset store). Every tenant table is org_id-scoped. `vs_cve_metadata`
# is org-agnostic shared threat intelligence (NVD/KEV/EPSS), not tenant data.
#
# See docs/VS-MODULE-DESIGN.md for the full design + relationships.

import uuid

from sqlalchemy import (
    Column, String, DateTime, JSON, Integer, Boolean, Float, Text,
    ForeignKey, LargeBinary, UniqueConstraint, Index,
)
from sqlalchemy.sql import func

from utils.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Scan configuration
# ---------------------------------------------------------------------------
class VsScanProfile(Base):
    """Reusable, customer-configurable scan configuration."""
    __tablename__ = "vs_scan_profiles"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    intensity = Column(String, nullable=False, default="standard")   # light|standard|deep
    engines = Column(JSON, nullable=False, default=list)             # ["nuclei","nmap_nse","sslyze"]
    authenticated = Column(Boolean, nullable=False, default=False)
    credential_id = Column(String, ForeignKey("vs_credentials.id", ondelete="SET NULL"), nullable=True)
    safe_mode = Column(Boolean, nullable=False, default=True)        # block intrusive / DoS templates
    max_requests_per_sec = Column(Integer, nullable=False, default=20)
    scan_window = Column(JSON, nullable=True)                        # {"start":"22:00","end":"06:00","tz":"UTC"}
    web_scan = Column(Boolean, nullable=False, default=True)         # OWASP Top-10 pass
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "name": self.name,
            "intensity": self.intensity, "engines": self.engines or [],
            "authenticated": self.authenticated, "credential_id": self.credential_id,
            "safe_mode": self.safe_mode, "max_requests_per_sec": self.max_requests_per_sec,
            "scan_window": self.scan_window, "web_scan": self.web_scan,
            "created_at": (self.created_at.isoformat() + "Z") if self.created_at else None,
        }


class VsScan(Base):
    """A scan definition + schedule (mirrors AsmDiscovery). Targets are asset_ids
    from the existing Asset Inventory — no parallel asset store."""
    __tablename__ = "vs_scans"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    profile_id = Column(String, ForeignKey("vs_scan_profiles.id", ondelete="RESTRICT"), nullable=False)
    asset_ids = Column(JSON, nullable=False, default=list)
    schedule_type = Column(String, nullable=False, default="QUICK")  # QUICK|INTERVAL|CRON
    schedule_value = Column(String, nullable=True)                    # "24h" | "0 2 * * *"
    status = Column(String, nullable=False, default="PENDING")       # PENDING|RUNNING|COMPLETED|FAILED|PAUSED|DELETED
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    last_run_id = Column(String, nullable=True)                       # overlap prevention
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "name": self.name,
            "profile_id": self.profile_id, "asset_ids": self.asset_ids or [],
            "schedule_type": self.schedule_type, "schedule_value": self.schedule_value,
            "status": self.status,
            "last_run_at": (self.last_run_at.isoformat() + "Z") if self.last_run_at else None,
            "next_run_at": (self.next_run_at.isoformat() + "Z") if self.next_run_at else None,
            "created_at": (self.created_at.isoformat() + "Z") if self.created_at else None,
        }


class VsScanRun(Base):
    """One execution instance of a scan (mirrors AsmDiscoveryRun)."""
    __tablename__ = "vs_scan_runs"

    id = Column(String, primary_key=True, default=_uuid)
    scan_id = Column(String, ForeignKey("vs_scans.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="PENDING")   # PENDING|RUNNING|COMPLETED|FAILED|CANCELLED
    triggered_by = Column(String, nullable=False, default="schedule")  # schedule|manual|rescan
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    engine_versions = Column(JSON, nullable=True)   # provenance: {"nuclei":"3.x","templates":"<sha>"}
    stats = Column(JSON, nullable=True)             # {"targets":N,"findings":N,"new":N,"fixed":N,"reappeared":N}
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "scan_id": self.scan_id, "org_id": self.org_id,
            "status": self.status, "triggered_by": self.triggered_by,
            "started_at": (self.started_at.isoformat() + "Z") if self.started_at else None,
            "completed_at": (self.completed_at.isoformat() + "Z") if self.completed_at else None,
            "engine_versions": self.engine_versions, "stats": self.stats,
            "error_message": self.error_message,
        }


class VsScanTarget(Base):
    """Resolved, authorized target for a run (audit of what was authorized)."""
    __tablename__ = "vs_scan_targets"

    id = Column(String, primary_key=True, default=_uuid)
    scan_run_id = Column(String, ForeignKey("vs_scan_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    host = Column(String, nullable=False)
    ports = Column(JSON, nullable=True)
    authorized = Column(Boolean, nullable=False, default=False)   # ownership-verified at enqueue time
    status = Column(String, nullable=False, default="pending")     # pending|scanned|skipped|error


# ---------------------------------------------------------------------------
# Vulnerability intelligence (shared, org-agnostic)
# ---------------------------------------------------------------------------
class VsCveMetadata(Base):
    """Authoritative CVE intelligence cache — NVD (CVSS v3.1/v4.0), CISA KEV,
    FIRST EPSS. Shared across tenants; refreshed by the feed-sync job."""
    __tablename__ = "vs_cve_metadata"

    cve_id = Column(String, primary_key=True)
    cvss_v31_score = Column(Float, nullable=True)
    cvss_v31_vector = Column(String, nullable=True)
    cvss_v40_score = Column(Float, nullable=True)
    cvss_v40_vector = Column(String, nullable=True)
    epss_score = Column(Float, nullable=True)          # 0..1
    epss_percentile = Column(Float, nullable=True)
    kev = Column(Boolean, nullable=False, default=False)
    kev_date_added = Column(DateTime, nullable=True)
    kev_due_date = Column(DateTime, nullable=True)
    cwe_ids = Column(JSON, nullable=True)
    affected_versions = Column(JSON, nullable=True)    # CPE ranges for version matching
    references = Column(JSON, nullable=True)
    published_at = Column(DateTime, nullable=True)
    modified_at = Column(DateTime, nullable=True)
    last_synced_at = Column(DateTime, nullable=True, index=True)

    def to_dict(self) -> dict:
        return {
            "cve_id": self.cve_id,
            "cvss_v31": {"score": self.cvss_v31_score, "vector": self.cvss_v31_vector},
            "cvss_v40": {"score": self.cvss_v40_score, "vector": self.cvss_v40_vector},
            "epss": self.epss_score, "epss_percentile": self.epss_percentile,
            "kev": self.kev,
            "kev_date_added": (self.kev_date_added.isoformat() + "Z") if self.kev_date_added else None,
            "kev_due_date": (self.kev_due_date.isoformat() + "Z") if self.kev_due_date else None,
            "cwe_ids": self.cwe_ids, "affected_versions": self.affected_versions,
            "references": self.references,
            "published_at": (self.published_at.isoformat() + "Z") if self.published_at else None,
            "modified_at": (self.modified_at.isoformat() + "Z") if self.modified_at else None,
        }


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------
class VsFinding(Base):
    """A vulnerability finding, linked to the existing assets table. Deduped
    across scans by (org_id, dedup_key)."""
    __tablename__ = "vs_findings"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_run_id = Column(String, ForeignKey("vs_scan_runs.id", ondelete="SET NULL"), nullable=True)
    first_seen_run_id = Column(String, nullable=True)
    dedup_key = Column(String, nullable=False, index=True)   # sha256(asset|plugin|cve|location)
    source_engine = Column(String, nullable=False)           # nuclei|nmap_nse|sslyze|openvas
    plugin_id = Column(String, nullable=True)
    cve_id = Column(String, ForeignKey("vs_cve_metadata.cve_id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)                 # owasp_a03|tls|default_creds|cve_match|misconfig
    location = Column(JSON, nullable=True)
    evidence = Column(Text, nullable=True)                   # sanitized before persist
    confidence = Column(String, nullable=False, default="tentative")  # tentative|firm|confirmed
    severity = Column(String, nullable=False)                # critical|high|medium|low|info
    cvss_base = Column(Float, nullable=True)
    epss = Column(Float, nullable=True)
    kev = Column(Boolean, nullable=False, default=False)
    composite_risk = Column(Integer, nullable=True)          # 0..100
    risk_factors = Column(JSON, nullable=True)               # explainable ScoreFactor breakdown
    status = Column(String, nullable=False, default="open", index=True)
    assigned_to = Column(String, nullable=True)
    sla_due_at = Column(DateTime, nullable=True, index=True)
    first_detected_at = Column(DateTime, server_default=func.now())
    last_detected_at = Column(DateTime, server_default=func.now())
    resolved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("org_id", "dedup_key", name="uq_vs_finding_dedup"),
        Index("ix_vs_findings_org_status_sev", "org_id", "status", "severity"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "asset_id": self.asset_id,
            "scan_run_id": self.scan_run_id, "source_engine": self.source_engine,
            "plugin_id": self.plugin_id, "cve_id": self.cve_id,
            "title": self.title, "description": self.description, "category": self.category,
            "location": self.location, "evidence": self.evidence, "confidence": self.confidence,
            "severity": self.severity, "cvss_base": self.cvss_base, "epss": self.epss,
            "kev": self.kev, "composite_risk": self.composite_risk, "risk_factors": self.risk_factors,
            "status": self.status, "assigned_to": self.assigned_to,
            "sla_due_at": (self.sla_due_at.isoformat() + "Z") if self.sla_due_at else None,
            "first_detected_at": (self.first_detected_at.isoformat() + "Z") if self.first_detected_at else None,
            "last_detected_at": (self.last_detected_at.isoformat() + "Z") if self.last_detected_at else None,
            "resolved_at": (self.resolved_at.isoformat() + "Z") if self.resolved_at else None,
        }


class VsFindingHistory(Base):
    """Audit trail / lifecycle state transitions for a finding."""
    __tablename__ = "vs_finding_history"

    id = Column(String, primary_key=True, default=_uuid)
    finding_id = Column(String, ForeignKey("vs_findings.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=False)
    actor_user_id = Column(String, nullable=True)   # null = system-driven
    justification = Column(Text, nullable=True)      # required for accepted_risk / false_positive
    at = Column(DateTime, server_default=func.now(), index=True)


class VsRemediation(Base):
    """Remediation guidance, keyed by CVE (shared) or a specific finding."""
    __tablename__ = "vs_remediation"

    id = Column(String, primary_key=True, default=_uuid)
    cve_id = Column(String, nullable=True, index=True)
    finding_id = Column(String, ForeignKey("vs_findings.id", ondelete="CASCADE"), nullable=True)
    org_id = Column(String, nullable=True)           # null = shared/global guidance
    summary = Column(Text, nullable=False)
    fixed_version = Column(String, nullable=True)
    steps = Column(JSON, nullable=True)
    references = Column(JSON, nullable=True)
    effort = Column(String, nullable=True)           # low|medium|high


class VsTrendSnapshot(Base):
    """Daily per-org severity snapshot for trend history (Domain 8). One row per
    org per day, written by the scheduler from REAL finding counts."""
    __tablename__ = "vs_trend_snapshots"
    __table_args__ = (
        UniqueConstraint("org_id", "snapshot_date", name="uq_vs_trend_org_day"),
    )

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_date = Column(String, nullable=False)   # YYYY-MM-DD (UTC)
    total = Column(Integer, nullable=False, default=0)
    critical = Column(Integer, nullable=False, default=0)
    high = Column(Integer, nullable=False, default=0)
    medium = Column(Integer, nullable=False, default=0)
    low = Column(Integer, nullable=False, default=0)
    kev = Column(Integer, nullable=False, default=0)
    open_count = Column(Integer, nullable=False, default=0)
    remediated_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "date": self.snapshot_date, "total": self.total,
            "critical": self.critical, "high": self.high,
            "medium": self.medium, "low": self.low, "kev": self.kev,
            "open": self.open_count, "remediated": self.remediated_count,
        }


class VsCredential(Base):
    """Encrypted credential for authenticated scans. Secret is envelope-encrypted
    ciphertext ONLY — never plaintext, never logged, decrypted just-in-time."""
    __tablename__ = "vs_credentials"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    cred_type = Column(String, nullable=False)       # http_basic|http_form|ssh|bearer
    username = Column(String, nullable=True)
    secret_ciphertext = Column(LargeBinary, nullable=False)
    secret_kms_key_id = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

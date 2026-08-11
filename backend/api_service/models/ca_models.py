# models/ca_models.py
#
# Compliance & Audit (CA) module data model.
#
# CA is a consumer of the platform's own data: evidence rows point (via
# source_ref) at REAL rows in vs_scan_runs / vs_findings / asm_* / audit_logs /
# assets. There is NO parallel asset store and NO copy of findings.
#
# Core shape: a canonical "checks" layer sits between evidence and framework
# controls. Evidence attaches to checks; ca_control_check_map fans one check
# out to every control it satisfies across all frameworks ("collect once,
# apply everywhere").
#
# Integrity rules (enforced in routes/engine, plus DB REVOKEs in the migration):
#   - ca_evidence and ca_audit_trail are append-only (no UPDATE/DELETE).
#   - automated evidence is hash-stamped (content_hash) at insert.
#   - N/A needs justification; overrides can never force "satisfied".
#
# See docs/CA-MODULE-DESIGN.md for the full design.

import uuid

from sqlalchemy import (
    Column, String, DateTime, JSON, Integer, BigInteger, Boolean, Float, Text,
    ForeignKey, Identity, LargeBinary, UniqueConstraint, Index,
)
from sqlalchemy.sql import func

from utils.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


# ---------------------------------------------------------------------------
# Framework & control catalog (org-agnostic, like vs_cve_metadata)
# ---------------------------------------------------------------------------
class CaFramework(Base):
    """A compliance framework version (SOC 2, ISO 27001, PCI-DSS, DPDP, ...).
    Data-driven: seeded from data/frameworks/*.json — never hardcoded."""
    __tablename__ = "ca_frameworks"

    id = Column(String, primary_key=True, default=_uuid)
    key = Column(String, nullable=False)            # soc2|iso27001|pci_dss|gdpr|hipaa|dpdp|cert_in|nist_csf|cis_v8
    name = Column(String, nullable=False)
    version = Column(String, nullable=False)        # "2017"|"2022"|"4.0"|"2023"
    authority = Column(String, nullable=True)       # AICPA|ISO|PCI SSC|EU|HHS|MeitY|CERT-In|NIST|CIS
    region = Column(String, nullable=True)          # global|in|eu|us
    description = Column(Text, nullable=True)
    is_reference = Column(Boolean, nullable=False, default=False)  # NIST CSF / CIS baselines
    source_checksum = Column(String, nullable=True) # sha256 of the seed JSON
    loaded_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("key", "version", name="uq_ca_framework_key_version"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "key": self.key, "name": self.name, "version": self.version,
            "authority": self.authority, "region": self.region,
            "description": self.description, "is_reference": self.is_reference,
        }


class CaControl(Base):
    """One control within a framework. description is a paraphrase — standard
    text (ISO/PCI) is copyrighted and must never be stored verbatim."""
    __tablename__ = "ca_controls"

    id = Column(String, primary_key=True, default=_uuid)
    framework_id = Column(String, ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False, index=True)
    control_ref = Column(String, nullable=False)    # "CC6.1"|"A.8.8"|"11.3.1"|"Art.32"
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)        # TSC / Annex / requirement grouping
    criticality = Column(String, nullable=False, default="medium")  # critical|high|medium|low → gap SLA
    control_type = Column(String, nullable=False, default="technical")  # technical|administrative|physical
    evidence_guidance = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("framework_id", "control_ref", name="uq_ca_control_ref"),
        Index("ix_ca_controls_fw_cat", "framework_id", "category"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "framework_id": self.framework_id, "control_ref": self.control_ref,
            "title": self.title, "description": self.description, "category": self.category,
            "criticality": self.criticality, "control_type": self.control_type,
            "evidence_guidance": self.evidence_guidance,
        }


class CaCheck(Base):
    """Canonical, framework-agnostic requirement. Evidence attaches HERE."""
    __tablename__ = "ca_checks"

    id = Column(String, primary_key=True, default=_uuid)
    key = Column(String, nullable=False, unique=True)   # "vs.scan_recency.quarterly"
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    collection = Column(String, nullable=False, default="automated")  # automated|manual
    logic_key = Column(String, nullable=True)       # registry key (automated only)
    logic_params = Column(JSON, nullable=True)      # {"max_age_days": 92, ...}
    source_type = Column(String, nullable=True)     # asm|vs|audit_trail|scan_config|policy|manual
    freshness_days = Column(Integer, nullable=False, default=90)
    weight = Column(Integer, nullable=False, default=1)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "key": self.key, "name": self.name, "description": self.description,
            "collection": self.collection, "logic_key": self.logic_key,
            "logic_params": self.logic_params, "source_type": self.source_type,
            "freshness_days": self.freshness_days, "weight": self.weight,
        }


class CaControlCheckMap(Base):
    """control ⇄ check many-to-many with a human-readable rationale (shown in UI)."""
    __tablename__ = "ca_control_check_map"

    id = Column(String, primary_key=True, default=_uuid)
    control_id = Column(String, ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False, index=True)
    check_id = Column(String, ForeignKey("ca_checks.id", ondelete="CASCADE"), nullable=False, index=True)
    required = Column(Boolean, nullable=False, default=True)  # False → supporting only
    rationale = Column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("control_id", "check_id", name="uq_ca_ctrl_check"),)


# ---------------------------------------------------------------------------
# Org-scoped enablement
# ---------------------------------------------------------------------------
class CaOrgFramework(Base):
    __tablename__ = "ca_org_frameworks"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    framework_id = Column(String, ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, nullable=False, default="active")   # active|paused
    target_date = Column(DateTime, nullable=True)
    enabled_by = Column(String, nullable=True)
    next_eval_at = Column(DateTime, nullable=True, index=True)  # scheduler tick due-check
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("org_id", "framework_id", name="uq_ca_org_fw"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "framework_id": self.framework_id,
            "status": self.status, "target_date": _iso(self.target_date),
            "enabled_by": self.enabled_by, "created_at": _iso(self.created_at),
        }


# ---------------------------------------------------------------------------
# Evidence (append-only) & encrypted files
# ---------------------------------------------------------------------------
class CaEvidenceFile(Base):
    """Manual uploads. Envelope-encrypted at rest (utils/crypto.py, same pattern
    as vs_credentials). sha256 is of the PLAINTEXT, recorded before encryption."""
    __tablename__ = "ca_evidence_files"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    content_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    sha256 = Column(String, nullable=False)
    ciphertext = Column(LargeBinary, nullable=False)
    uploaded_by = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class CaEvidence(Base):
    """One piece of evidence. INSERT-ONLY: refresh = new row + predecessor
    marked superseded; the only in-place mutation the app performs is the
    status column (valid→stale/superseded/revoked) via engine/admin routes."""
    __tablename__ = "ca_evidence"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    check_id = Column(String, ForeignKey("ca_checks.id", ondelete="SET NULL"), nullable=True, index=True)
    collection = Column(String, nullable=False)     # automated|manual — immutable after insert
    source_type = Column(String, nullable=False)    # asm|vs|audit_trail|scan_config|policy|manual_upload
    source_ref = Column(JSON, nullable=True)        # {"table":"vs_scan_runs","ids":[...]} → REAL rows
    summary = Column(Text, nullable=True)
    content = Column(JSON, nullable=True)           # structured snapshot at capture time
    content_hash = Column(String, nullable=False)   # sha256(canonical(content)+canonical(source_ref))
    result = Column(String, nullable=True)          # pass|fail|n/a
    captured_at = Column(DateTime, server_default=func.now(), index=True)
    valid_until = Column(DateTime, nullable=True, index=True)
    status = Column(String, nullable=False, default="valid", index=True)  # valid|stale|superseded|revoked
    revoke_justification = Column(Text, nullable=True)
    uploaded_by = Column(String, nullable=True)     # manual only; NULL = system
    file_id = Column(String, ForeignKey("ca_evidence_files.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (Index("ix_ca_evidence_org_check", "org_id", "check_id", "status"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "check_id": self.check_id,
            "collection": self.collection, "source_type": self.source_type,
            "source_ref": self.source_ref, "summary": self.summary, "content": self.content,
            "content_hash": self.content_hash, "result": self.result,
            "captured_at": _iso(self.captured_at), "valid_until": _iso(self.valid_until),
            "status": self.status, "uploaded_by": self.uploaded_by, "file_id": self.file_id,
        }


class CaEvidenceControlLink(Base):
    """Materialized evidence→control links (via the check map at capture time)."""
    __tablename__ = "ca_evidence_control_links"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    evidence_id = Column(String, ForeignKey("ca_evidence.id", ondelete="CASCADE"), nullable=False, index=True)
    control_id = Column(String, ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False, index=True)

    __table_args__ = (UniqueConstraint("evidence_id", "control_id", name="uq_ca_ev_ctrl"),)


# ---------------------------------------------------------------------------
# Control state & posture history
# ---------------------------------------------------------------------------
class CaControlState(Base):
    """Current computed state per (org, control) — the ONLY source for posture
    math. status: satisfied|partial|gap|not_applicable|unknown."""
    __tablename__ = "ca_control_states"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    control_id = Column(String, ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="unknown", index=True)
    computed_at = Column(DateTime, nullable=True)
    computed_from = Column(JSON, nullable=True)     # [{check_id, evidence_id, result, valid_until}]
    na_justification = Column(Text, nullable=True)  # required when status=not_applicable
    na_scope = Column(Text, nullable=True)
    na_set_by = Column(String, nullable=True)
    na_set_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("org_id", "control_id", name="uq_ca_state"),
        Index("ix_ca_state_org_status", "org_id", "status"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "control_id": self.control_id,
            "status": self.status, "computed_at": _iso(self.computed_at),
            "computed_from": self.computed_from, "na_justification": self.na_justification,
            "na_scope": self.na_scope, "na_set_by": self.na_set_by, "na_set_at": _iso(self.na_set_at),
        }


class CaPostureSnapshot(Base):
    """Daily per-org-per-framework snapshot (mirrors VsTrendSnapshot). Powers
    trend charts with REAL history — empty until the engine has run."""
    __tablename__ = "ca_posture_snapshots"
    __table_args__ = (
        UniqueConstraint("org_id", "framework_id", "snapshot_date", name="uq_ca_snap"),
    )

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    framework_id = Column(String, ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_date = Column(String, nullable=False)  # YYYY-MM-DD (UTC), same style as vs_trend_snapshots
    satisfied = Column(Integer, nullable=False, default=0)
    partial = Column(Integer, nullable=False, default=0)
    gap = Column(Integer, nullable=False, default=0)
    not_applicable = Column(Integer, nullable=False, default=0)
    unknown = Column(Integer, nullable=False, default=0)
    score = Column(Float, nullable=True)            # §4 formula result for the day
    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "date": self.snapshot_date, "framework_id": self.framework_id,
            "satisfied": self.satisfied, "partial": self.partial, "gap": self.gap,
            "not_applicable": self.not_applicable, "unknown": self.unknown, "score": self.score,
        }


# ---------------------------------------------------------------------------
# Gaps & remediation (clones the VS finding lifecycle)
# ---------------------------------------------------------------------------
class CaGap(Base):
    __tablename__ = "ca_gaps"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    control_id = Column(String, ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False, index=True)
    dedup_key = Column(String, nullable=False, index=True)   # control_id — one open gap per control
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    missing = Column(JSON, nullable=True)           # failing/absent checks: what's needed to close
    severity = Column(String, nullable=False, index=True)    # inherited from control.criticality
    status = Column(String, nullable=False, default="open", index=True)
    # open|in_progress|resolved|verified|closed|accepted_risk
    assigned_to = Column(String, nullable=True)
    sla_due_at = Column(DateTime, nullable=True, index=True)
    first_detected_at = Column(DateTime, server_default=func.now())
    last_detected_at = Column(DateTime, server_default=func.now())
    resolved_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_ca_gaps_org_status_sev", "org_id", "status", "severity"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "control_id": self.control_id,
            "title": self.title, "description": self.description, "missing": self.missing,
            "severity": self.severity, "status": self.status, "assigned_to": self.assigned_to,
            "sla_due_at": _iso(self.sla_due_at),
            "first_detected_at": _iso(self.first_detected_at),
            "last_detected_at": _iso(self.last_detected_at),
            "resolved_at": _iso(self.resolved_at),
        }


class CaGapHistory(Base):
    """Lifecycle transitions for a gap (mirrors VsFindingHistory)."""
    __tablename__ = "ca_gap_history"

    id = Column(String, primary_key=True, default=_uuid)
    gap_id = Column(String, ForeignKey("ca_gaps.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=False)
    actor_user_id = Column(String, nullable=True)   # null = system (evaluator)
    justification = Column(Text, nullable=True)
    at = Column(DateTime, server_default=func.now(), index=True)


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------
class CaPolicy(Base):
    """org_id NULL = global template (vs_cve_metadata precedent for shared rows)."""
    __tablename__ = "ca_policies"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    key = Column(String, nullable=True)             # "access-control-policy"
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft|active|archived|template
    current_version_id = Column(String, nullable=True)        # FK-by-convention to ca_policy_versions
    owner_user_id = Column(String, nullable=True)
    review_frequency_days = Column(Integer, nullable=False, default=365)
    next_review_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "key": self.key, "title": self.title,
            "description": self.description, "status": self.status,
            "current_version_id": self.current_version_id, "owner_user_id": self.owner_user_id,
            "review_frequency_days": self.review_frequency_days,
            "next_review_at": _iso(self.next_review_at), "created_at": _iso(self.created_at),
        }


class CaPolicyVersion(Base):
    __tablename__ = "ca_policy_versions"

    id = Column(String, primary_key=True, default=_uuid)
    policy_id = Column(String, ForeignKey("ca_policies.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    body_md = Column(Text, nullable=False)
    sha256 = Column(String, nullable=False)         # what members acknowledge
    published_by = Column(String, nullable=True)
    published_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("policy_id", "version", name="uq_ca_policy_ver"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "policy_id": self.policy_id, "version": self.version,
            "body_md": self.body_md, "sha256": self.sha256,
            "published_by": self.published_by, "published_at": _iso(self.published_at),
        }


class CaPolicyAck(Base):
    __tablename__ = "ca_policy_acks"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    policy_version_id = Column(String, ForeignKey("ca_policy_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    member_user_id = Column(String, nullable=False)  # user id
    acked_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("policy_version_id", "member_user_id", name="uq_ca_ack"),)


# ---------------------------------------------------------------------------
# Audits & auditor access
# ---------------------------------------------------------------------------
class CaAudit(Base):
    __tablename__ = "ca_audits"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    framework_id = Column(String, ForeignKey("ca_frameworks.id", ondelete="RESTRICT"), nullable=False)
    name = Column(String, nullable=False)           # "SOC 2 Type II FY2026"
    audit_firm = Column(String, nullable=True)
    status = Column(String, nullable=False, default="preparation")  # preparation|fieldwork|remediation|complete
    period_start = Column(DateTime, nullable=True)
    period_end = Column(DateTime, nullable=True)
    scope = Column(JSON, nullable=True)             # {"control_ids":[...]} | {"categories":[...]} | null = whole framework
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "framework_id": self.framework_id,
            "name": self.name, "audit_firm": self.audit_firm, "status": self.status,
            "period_start": _iso(self.period_start), "period_end": _iso(self.period_end),
            "scope": self.scope, "created_by": self.created_by, "created_at": _iso(self.created_at),
        }


class CaAuditorGrant(Base):
    """Scoped read-only access. NOT a member_profiles row — auditors never enter
    org RBAC. Opaque token stored hashed; plaintext shown once at creation."""
    __tablename__ = "ca_auditor_grants"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    audit_id = Column(String, ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    auditor_email = Column(String, nullable=False)
    token_hash = Column(String, nullable=False, index=True)   # sha256 of the bearer token
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    last_access_at = Column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "audit_id": self.audit_id, "auditor_email": self.auditor_email,
            "expires_at": _iso(self.expires_at), "revoked_at": _iso(self.revoked_at),
            "created_by": self.created_by, "created_at": _iso(self.created_at),
            "last_access_at": _iso(self.last_access_at),
        }


class CaAuditFinding(Base):
    """Auditor-raised findings."""
    __tablename__ = "ca_audit_findings"

    id = Column(String, primary_key=True, default=_uuid)
    audit_id = Column(String, ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    control_id = Column(String, ForeignKey("ca_controls.id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String, nullable=True)        # critical|high|medium|low
    status = Column(String, nullable=False, default="open")   # open|responded|resolved|accepted
    raised_by_grant_id = Column(String, ForeignKey("ca_auditor_grants.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id, "audit_id": self.audit_id, "control_id": self.control_id,
            "title": self.title, "description": self.description, "severity": self.severity,
            "status": self.status, "raised_by_grant_id": self.raised_by_grant_id,
            "created_at": _iso(self.created_at),
        }


class CaAttestation(Base):
    """Certificates / audit reports received (file encrypted via ca_evidence_files)."""
    __tablename__ = "ca_attestations"

    id = Column(String, primary_key=True, default=_uuid)
    audit_id = Column(String, ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String, nullable=True)            # soc2_type2_report|iso_certificate|pci_aoc
    valid_from = Column(DateTime, nullable=True)
    valid_until = Column(DateTime, nullable=True)
    file_id = Column(String, ForeignKey("ca_evidence_files.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id, "audit_id": self.audit_id, "kind": self.kind,
            "valid_from": _iso(self.valid_from), "valid_until": _iso(self.valid_until),
            "file_id": self.file_id, "created_at": _iso(self.created_at),
        }


# ---------------------------------------------------------------------------
# Immutable CA audit trail (hash-chained)
# ---------------------------------------------------------------------------
class CaAuditTrail(Base):
    """Append-only, hash-chained per org. UPDATE/DELETE revoked at DB level in
    the migration. actor_user_id: user id | NULL=system | "auditor:<grant_id>"."""
    __tablename__ = "ca_audit_trail"

    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, nullable=False, index=True)
    actor_user_id = Column(String, nullable=True)
    action = Column(String, nullable=False, index=True)   # "control.na_set"|"evidence.uploaded"|...
    target = Column(String, nullable=True)                # "control:<id>"|"evidence:<id>"
    meta = Column(JSON, nullable=True)
    at = Column(DateTime, server_default=func.now(), index=True)
    # Monotonic DB-assigned sequence: gives the hash chain a deterministic
    # order (uuid ids + microsecond timestamps cannot).
    seq = Column(BigInteger, Identity(), nullable=False, index=True)
    prev_hash = Column(String, nullable=True)
    row_hash = Column(String, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "org_id": self.org_id, "actor_user_id": self.actor_user_id,
            "action": self.action, "target": self.target, "meta": self.meta,
            "at": _iso(self.at), "row_hash": self.row_hash,
        }

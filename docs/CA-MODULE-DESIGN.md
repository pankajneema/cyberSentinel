# CyberSentinel — Compliance & Audit (CA) Module Design

**Status:** Design approved for build · **Companion doc:** `VS-MODULE-DESIGN.md`
**Scope:** Complete data model, API design, evidence-collection engine, posture algorithm, cross-framework mapping, frontend structure, integration verification, phased build plan.

---

## 0. Executive summary & differentiator strategy

Vanta/Drata/Secureframe are *integration brokers*: they pull security signals from third-party tools (AWS, Okta, CrowdStrike) and map them to controls. CyberSentinel **owns the scanner**, so CA's evidence for technical controls is first-party, continuously refreshed, and cryptographically traceable to a real scan run in our own database:

| Existing data | CA evidence for |
|---|---|
| `assets` (shared Asset Inventory) | Asset management / inventory controls (SOC 2 CC6.1, ISO A.5.9, CIS 1.x) |
| `vs_findings` / `vs_scan_runs` | Vulnerability management (PCI-DSS 11.3 quarterly scans, ISO A.8.8, SOC 2 CC7.1) |
| `audit_logs` + `vs_finding_history` | Access control / change management (SOC 2 CC6.x/CC8.1, ISO A.5.15) |
| `vs_scans` / `asm_discoveries` schedule config (`schedule_type`, `next_run_at`) | Continuous monitoring controls (SOC 2 CC7.2, NIST CSF DE.CM) |

Architecture in one line: **a canonical *checks* layer** sits between evidence and framework controls. Evidence is collected once per check; a check maps to N controls across N frameworks ("collect once, apply everywhere"). Continuous evaluation runs **in Python** (scheduler tick + event hooks after ASM/VS ingest) — *not* in Go workers — because evaluation is pure DB-query + rule logic over existing SQLAlchemy models, with no tool execution. Go/RabbitMQ stays what it is: the scan-execution plane.

**Honesty invariants (enforced in code, not convention):**
1. A control with no evidence is `unknown`, scores **0**, and is displayed as "Not assessed" — never hidden, never defaulted to satisfied.
2. Percentages are computed only from `ca_control_states` rows; there is no code path that renders a number not derived from them. Scores are **floored**, never rounded up.
3. Expired evidence contributes nothing: the evaluator degrades control status when evidence passes `valid_until`.
4. Manual overrides can mark a control N/A or *downgrade* it, but can **never** force `satisfied` on a control whose automated checks are failing. (Security implication: prevents dashboard-driven fraud; Vanta allows blanket waivers — we deliberately don't.)
5. Automated evidence is append-only and hash-stamped; there is no update endpoint for it.

---

## 1. Data model (SQLAlchemy async, PostgreSQL)

All models follow existing conventions exactly (`models/vs_models.py` is the template):
`from utils.database import Base`; **String UUID PKs** (`default=lambda: str(uuid.uuid4())`); `org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)`; **status/severity as String columns** with allowed values in comments (no native enums — matches repo style); `DateTime(timezone=True), server_default=func.now()` timestamps; `to_dict()` on every model; `user_id`/actor fields are Supabase `sub` strings, not FKs.

New file: `backend/api_service/models/ca_models.py` (+ `import models.ca_models` in `migrations/env.py` line ~15-24 — **mandatory or autogenerate drops the tables**).

### 1.1 Framework & control catalog (org-agnostic, like `vs_cve_metadata`)

```python
class CaFramework(Base):
    __tablename__ = "ca_frameworks"
    id = Column(String, primary_key=True, default=_uuid)
    key = Column(String, nullable=False)            # soc2 | iso27001 | pci_dss | gdpr | hipaa | dpdp | cert_in | nist_csf | cis_v8
    name = Column(String, nullable=False)           # "SOC 2 (2017 TSC)"
    version = Column(String, nullable=False)        # "2017", "2022", "4.0", "2023"
    authority = Column(String)                      # AICPA | ISO | PCI SSC | EU | HHS | MeitY | CERT-In | NIST | CIS
    region = Column(String)                         # global | in | eu | us
    description = Column(Text)
    is_reference = Column(Boolean, default=False)   # NIST CSF / CIS = baseline references
    source_checksum = Column(String)                # sha256 of the seed JSON that loaded it
    loaded_at = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("key", "version", name="uq_ca_framework_key_version"),)

class CaControl(Base):
    __tablename__ = "ca_controls"
    id = Column(String, primary_key=True, default=_uuid)
    framework_id = Column(String, ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False, index=True)
    control_ref = Column(String, nullable=False)    # "CC6.1", "A.8.8", "11.3.1", "Art.32", "164.312(a)(1)", "S.8(5)"
    title = Column(String, nullable=False)
    description = Column(Text)                      # paraphrased — see licensing note below
    category = Column(String)                       # domain/TSC/Annex grouping, used for UI rollups
    criticality = Column(String, default="medium")  # critical | high | medium | low → drives gap SLA
    control_type = Column(String, default="technical")  # technical | administrative | physical
    evidence_guidance = Column(Text)                # what an auditor expects to see
    __table_args__ = (UniqueConstraint("framework_id", "control_ref", name="uq_ca_control_ref"),
                      Index("ix_ca_controls_fw_cat", "framework_id", "category"))
```

> **Licensing (flagged):** ISO 27001 and PCI-DSS control *text* is copyrighted. Seed files store `control_ref` + our own paraphrase in `description`. Never ship verbatim standard text.

### 1.2 The canonical checks layer (the cross-framework engine)

```python
class CaCheck(Base):
    """Canonical, framework-agnostic requirement. Evidence attaches HERE, not to controls."""
    __tablename__ = "ca_checks"
    id = Column(String, primary_key=True, default=_uuid)
    key = Column(String, unique=True, nullable=False)   # "vs.scan_recency.quarterly", "vs.no_open_criticals", "asm.inventory_maintained"
    name = Column(String, nullable=False)
    description = Column(Text)
    collection = Column(String, nullable=False)     # automated | manual
    logic_key = Column(String)                      # registry key of the Python evaluator fn (automated only)
    logic_params = Column(JSON)                     # {"max_age_days": 92, "severity": "critical", "max_open": 0}
    source_type = Column(String)                    # asm | vs | audit_trail | scan_config | policy | manual
    freshness_days = Column(Integer, nullable=False, default=90)  # evidence validity window
    weight = Column(Integer, default=1)             # weight within a control (see §4)

class CaControlCheckMap(Base):
    """control ⇄ check many-to-many. One check satisfying N controls across N frameworks = 'collect once, apply everywhere'."""
    __tablename__ = "ca_control_check_map"
    id = Column(String, primary_key=True, default=_uuid)
    control_id = Column(String, ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False, index=True)
    check_id = Column(String, ForeignKey("ca_checks.id", ondelete="CASCADE"), nullable=False, index=True)
    required = Column(Boolean, default=True)        # required=False → contributes to 'partial' only
    rationale = Column(Text)                        # WHY this check satisfies this control — shown in UI (transparency req.)
    __table_args__ = (UniqueConstraint("control_id", "check_id", name="uq_ca_ctrl_check"),)
```

`control_mappings` from the spec = `ca_control_check_map`. Direct control↔control cross-framework equivalence is *derived* (two controls sharing ≥1 check are "related") — no second mapping table to keep consistent.

### 1.3 Org-scoped framework enablement

```python
class CaOrgFramework(Base):
    __tablename__ = "ca_org_frameworks"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    framework_id = Column(String, ForeignKey("ca_frameworks.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, default="active")       # active | paused
    target_date = Column(DateTime(timezone=True))   # audit-readiness target
    enabled_by = Column(String)                     # Supabase sub
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("org_id", "framework_id", name="uq_ca_org_fw"),)
```

### 1.4 Evidence & integrity

```python
class CaEvidence(Base):
    __tablename__ = "ca_evidence"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...)                            # standard org FK
    check_id = Column(String, ForeignKey("ca_checks.id"), nullable=True, index=True)  # null for ad-hoc manual evidence
    collection = Column(String, nullable=False)     # automated | manual  — IMMUTABLE after insert
    source_type = Column(String, nullable=False)    # asm | vs | audit_trail | scan_config | policy | manual_upload
    source_ref = Column(JSON)                       # {"table":"vs_scan_runs","ids":[...],"query_window":{...}} → REAL rows
    summary = Column(Text)                          # human-readable ("Quarterly scan completed 2026-06-14, 0 open criticals")
    content = Column(JSON)                          # structured snapshot at capture time (counts, ids, params)
    content_hash = Column(String, nullable=False)   # sha256(canonical_json(content) + source_ref) — integrity seal
    result = Column(String)                         # pass | fail | n/a  (automated checks record outcome)
    captured_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    valid_until = Column(DateTime(timezone=True), index=True)   # captured_at + check.freshness_days
    status = Column(String, default="valid", index=True)        # valid | stale | superseded | revoked
    uploaded_by = Column(String)                    # manual only (Supabase sub); NULL = system
    file_id = Column(String, ForeignKey("ca_evidence_files.id"), nullable=True)
    __table_args__ = (Index("ix_ca_evidence_org_check", "org_id", "check_id", "status"),)

class CaEvidenceFile(Base):
    """Manual uploads (policies, screenshots, reports). Envelope-encrypted like VsCredential.secret_ciphertext."""
    __tablename__ = "ca_evidence_files"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...)
    filename = Column(String, nullable=False)
    content_type = Column(String)
    size_bytes = Column(Integer)
    sha256 = Column(String, nullable=False)         # hash of PLAINTEXT, recorded before encryption
    ciphertext = Column(LargeBinary, nullable=False) # envelope-encrypted (same KMS/key pattern as vs_credentials)
    uploaded_by = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class CaEvidenceControlLink(Base):
    """Materialized evidence→control links (via check map at capture time) — powers 'which finding satisfies which control'."""
    __tablename__ = "ca_evidence_control_links"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...)
    evidence_id = Column(String, ForeignKey("ca_evidence.id", ondelete="CASCADE"), nullable=False, index=True)
    control_id = Column(String, ForeignKey("ca_controls.id", ondelete="CASCADE"), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("evidence_id", "control_id", name="uq_ca_ev_ctrl"),)
```

**Integrity rules (flagged, security-critical):**
- Automated evidence rows are **insert-only**. No PATCH/PUT endpoint exists for `ca_evidence`; refresh = insert new row, mark predecessor `superseded`. `collection` can never flip `manual→automated` (guard in route + CHECK constraint `collection IN ('automated','manual')`).
- `content_hash` is computed server-side at insert; the auditor package re-verifies hashes at export time and refuses to include rows that fail (tamper-evident).
- Manual evidence is always visibly badged `manual` end-to-end (API → UI → PDF) — synthetic evidence can't masquerade as system-collected.
- `source_ref` must resolve to real rows at capture time; the collector raises (and records nothing) if the referenced query returns empty when a `pass` is claimed.

### 1.5 Control state & posture

```python
class CaControlState(Base):
    """Current computed state per (org, control) — the ONLY source for posture math."""
    __tablename__ = "ca_control_states"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...); control_id = Column(String, ForeignKey("ca_controls.id"), nullable=False, index=True)
    status = Column(String, default="unknown", index=True)  # satisfied | partial | gap | not_applicable | unknown
    computed_at = Column(DateTime(timezone=True))
    computed_from = Column(JSON)        # [{check_id, evidence_id, result, valid_until}] — full transparency
    na_justification = Column(Text)     # required when status=not_applicable
    na_scope = Column(Text)             # what part of the org the N/A covers
    na_set_by = Column(String); na_set_at = Column(DateTime(timezone=True))
    __table_args__ = (UniqueConstraint("org_id", "control_id", name="uq_ca_state"),
                      Index("ix_ca_state_org_status", "org_id", "status"))

class CaPostureSnapshot(Base):
    """Daily per-org-per-framework snapshot (mirrors VsTrendSnapshot) — powers trend charts with REAL history."""
    __tablename__ = "ca_posture_snapshots"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...); framework_id = Column(String, ForeignKey("ca_frameworks.id"), nullable=False)
    snapshot_date = Column(Date, nullable=False)
    satisfied = Column(Integer, default=0); partial = Column(Integer, default=0)
    gap = Column(Integer, default=0); not_applicable = Column(Integer, default=0); unknown = Column(Integer, default=0)
    score = Column(Float)               # the §4 formula result, stored for the day
    __table_args__ = (UniqueConstraint("org_id", "framework_id", "snapshot_date", name="uq_ca_snap"),)
```

### 1.6 Gaps & remediation (clones the VS finding lifecycle)

```python
class CaGap(Base):
    __tablename__ = "ca_gaps"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...); control_id = Column(String, ForeignKey("ca_controls.id"), nullable=False, index=True)
    dedup_key = Column(String, index=True)          # f"{control_id}" — one open gap per control; UniqueConstraint(org_id, dedup_key) among open
    title = Column(String); description = Column(Text)
    missing = Column(JSON)                          # failing/absent checks: what's needed to close
    severity = Column(String, index=True)           # inherited from control.criticality
    status = Column(String, default="open", index=True)  # open | in_progress | resolved | verified | closed | accepted_risk
    assigned_to = Column(String); sla_due_at = Column(DateTime(timezone=True), index=True)
    first_detected_at = Column(...); last_detected_at = Column(...); resolved_at = Column(...)
    __table_args__ = (Index("ix_ca_gaps_org_status_sev", "org_id", "status", "severity"),)

class CaGapHistory(Base):     # mirrors VsFindingHistory exactly
    __tablename__ = "ca_gap_history"
    gap_id = Column(String, ForeignKey("ca_gaps.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(...); from_status = Column(String); to_status = Column(String)
    actor_user_id = Column(String)      # NULL = system (evaluator auto-resolved/reopened)
    justification = Column(Text); at = Column(DateTime(timezone=True), server_default=func.now())
```

Transitions reuse `routes/vs.py:_TRANSITIONS` semantics restricted to: `open→{in_progress,accepted_risk}`, `in_progress→{resolved,accepted_risk}`, `resolved→{verified,in_progress}`, `verified→{closed,in_progress}`, `closed→{in_progress}`, `accepted_risk→{in_progress}`. Justification required for `accepted_risk` (mirrors `_JUSTIFY_REQUIRED`). SLA days by control criticality reuse `_SLA_DAYS` values: critical 7 / high 15 / medium 30 / low 90. **The evaluator auto-resolves** a gap (with `actor_user_id=NULL` history row) when its control returns to `satisfied`, and auto-reopens on regression.

### 1.7 Policies

```python
class CaPolicy(Base):
    __tablename__ = "ca_policies"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, ForeignKey("organizations.id"), nullable=True, index=True)  # NULL = global template (vs_cve_metadata precedent)
    key = Column(String)                # "access-control-policy"
    title = Column(String, nullable=False); description = Column(Text)
    status = Column(String, default="draft")   # draft | active | archived   (templates: status="template")
    current_version_id = Column(String, ForeignKey("ca_policy_versions.id"), nullable=True)
    owner_user_id = Column(String)
    review_frequency_days = Column(Integer, default=365)   # drives policy-freshness check
    next_review_at = Column(DateTime(timezone=True))

class CaPolicyVersion(Base):
    __tablename__ = "ca_policy_versions"
    policy_id = Column(String, ForeignKey("ca_policies.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    body_md = Column(Text, nullable=False)          # markdown content
    sha256 = Column(String, nullable=False)         # what members acknowledge
    published_by = Column(String); published_at = Column(DateTime(timezone=True), server_default=func.now())

class CaPolicyAck(Base):
    __tablename__ = "ca_policy_acks"
    org_id = Column(...); policy_version_id = Column(String, ForeignKey("ca_policy_versions.id"), nullable=False, index=True)
    member_user_id = Column(String, nullable=False)  # Supabase sub
    acked_at = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("policy_version_id", "member_user_id", name="uq_ca_ack"),)
```

Policies link to controls **through checks**: each framework seeds administrative checks like `policy.access_control.active_and_acked` (`collection="automated"`, `source_type="policy"`) whose evaluator verifies: an active `CaPolicy` with matching `key` exists, version published, `next_review_at` in the future, and ack-rate ≥ threshold from `logic_params`. Publishing a policy version automatically produces evidence.

### 1.8 Audits & auditor access

```python
class CaAudit(Base):
    __tablename__ = "ca_audits"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...); framework_id = Column(String, ForeignKey("ca_frameworks.id"), nullable=False)
    name = Column(String, nullable=False)           # "SOC 2 Type II FY2026"
    audit_firm = Column(String); status = Column(String, default="preparation")  # preparation | fieldwork | remediation | complete
    period_start = Column(DateTime(timezone=True)); period_end = Column(DateTime(timezone=True))
    scope = Column(JSON)                            # {"control_ids":[...] } or {"categories":[...]} — subset in scope
    created_by = Column(String); created_at = Column(...)

class CaAuditorGrant(Base):
    """Scoped read-only access. NOT a member_profiles row — auditors never enter org RBAC."""
    __tablename__ = "ca_auditor_grants"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(...); audit_id = Column(String, ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    auditor_email = Column(String, nullable=False)
    token_hash = Column(String, nullable=False)     # sha256 of opaque bearer token; plaintext shown ONCE at creation
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    created_by = Column(String); created_at = Column(...); last_access_at = Column(DateTime(timezone=True))

class CaAuditFinding(Base):     # auditor-raised findings
    __tablename__ = "ca_audit_findings"
    audit_id = Column(String, ForeignKey("ca_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(...); control_id = Column(String, ForeignKey("ca_controls.id"))
    title = Column(String); description = Column(Text); severity = Column(String)
    status = Column(String, default="open")         # open | responded | resolved | accepted
    raised_by_grant_id = Column(String, ForeignKey("ca_auditor_grants.id"))
    created_at = Column(...)

class CaAttestation(Base):      # certificates / reports received
    __tablename__ = "ca_attestations"
    audit_id = Column(String, ForeignKey("ca_audits.id"), nullable=False, index=True)
    org_id = Column(...); kind = Column(String)     # soc2_type2_report | iso_certificate | pci_aoc
    valid_from = Column(...); valid_until = Column(...)
    file_id = Column(String, ForeignKey("ca_evidence_files.id"))   # encrypted storage reuse
```

**Auditor auth decision (flagged, security-critical):** auditors do **not** get Supabase accounts or `member_profiles` roles. Adding an `auditor` role to org RBAC would let auditor credentials hit every module's endpoints guarded by `get_current_user`. Instead: an opaque 256-bit token (stored hashed), accepted **only** by a dedicated `get_current_auditor` dependency on `/api/v1/ca/auditor/*` routes. Those routes are read-only by construction (GET + one POST for raising findings), filter everything through the grant's `audit_id → scope`, check `expires_at`/`revoked_at` on every request, and log every access to `ca_audit_trail`. Blast radius of a leaked auditor token = read access to one audit's evidence package until expiry, nothing else.

### 1.9 Immutable CA audit trail

```python
class CaAuditTrail(Base):
    """Append-only, hash-chained. Mirrors tenancy audit_logs but adds tamper-evidence."""
    __tablename__ = "ca_audit_trail"
    id = Column(String, primary_key=True, default=_uuid)
    org_id = Column(String, index=True)
    actor_user_id = Column(String)                  # Supabase sub | NULL=system | "auditor:<grant_id>"
    action = Column(String, nullable=False, index=True)  # "control.na_set", "evidence.uploaded", "gap.transition", "auditor.grant_created", "auditor.evidence_viewed", ...
    target = Column(String)                         # "control:<id>", "evidence:<id>", ...
    meta = Column(JSON)
    at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    prev_hash = Column(String)                      # hash of previous row for this org
    row_hash = Column(String, nullable=False)       # sha256(prev_hash + org_id + actor + action + target + canonical(meta) + at)
```

No update/delete endpoints; the Alembic migration also issues `REVOKE UPDATE, DELETE ON ca_audit_trail, ca_evidence FROM <app_role>` so immutability is DB-enforced, not just app-enforced. Every CA write route calls `ca_trail(db, org_id, actor, action, target, meta)` in the same transaction as the change. High-value events additionally mirror into the existing `audit_logs` table so org-level audit views stay complete.

### 1.10 Relationships to existing tables (read-only FKs / references)

- `ca_evidence.source_ref` → real rows in `vs_scan_runs`, `vs_findings`, `asm_*`, `audit_logs`, `vs_scans`, `asm_discoveries` (by id, JSON reference — no FK constraint across module boundaries, matching how ASM references `assets` via indexed String `asset_id`).
- Asset-scoped evidence (e.g., per-asset scan coverage) references `assets.id` — the single shared inventory. **No CA asset table exists.**
- `CaControl.criticality` → gap SLA; `member_profiles` supplies assignee identities (same as `vs_findings.assigned_to`).

---

## 2. FastAPI route design

New file `backend/api_service/routes/ca.py`: `router = APIRouter(prefix="/api/v1/ca", tags=["Compliance & Audit"])`, registered in `main.py` alongside existing routers (additive — no existing route changes). Auth uses the **canonical** stack: `utils/supabase_auth.get_current_user` → `CurrentUser`, `require_role`, `utils/tenancy.require_org` + `scope_to_org`. Writer guard mirrors vs.py:43: `_writer = require_role("owner", "admin", "analyst")`; destructive/admin ops (`framework enable, auditor grants, N/A marking`): `_admin = require_role("owner", "admin")`. Schemas in `schemas/ca_schema.py` (Create/Update/Response trio per entity, `Literal` unions for statuses, pagination as `{"items","total","page","page_size"}`).

| Method & path | Guard | Purpose / notes |
|---|---|---|
| `GET /frameworks` | user | Catalog + per-org enablement + live score per enabled framework |
| `POST /frameworks/{id}/enable` · `/pause` | _admin | Enable → seeds `ca_control_states` (all `unknown`), enqueues first evaluation. Trail: `framework.enabled` |
| `GET /controls?framework_id=&status=&category=&page=` | user | Paginated; joins `ca_control_states` |
| `GET /controls/{id}` | user | Control + state + `computed_from` + evidence (with `source_ref` links + rationale) + related controls in other frameworks (shared checks) |
| `PATCH /controls/{id}/applicability` | _admin | Set/unset N/A; body `{not_applicable, justification, scope}` — justification mandatory (400). Trail: `control.na_set` |
| `GET /evidence?check_id=&status=&collection=&page=` | user | Filterable evidence list |
| `POST /evidence` (multipart) | _writer | Manual upload → encrypt file, hash, insert `collection="manual"`. Trail: `evidence.uploaded` |
| `POST /evidence/{id}/revoke` | _admin | Only lifecycle mutation allowed (justification required); never delete. Trail |
| `GET /evidence/{id}/file` | user | Decrypt + stream; access trailed |
| `GET /gaps?status=&severity=&page=` · `GET /gaps/summary` | user | Gap analysis view; summary = counts by status/severity/framework |
| `PATCH /gaps/{id}/status` | _writer | VS-style transition endpoint: validate `_CA_TRANSITIONS` (409), justification for `accepted_risk` (400), write `CaGapHistory`, set/clear `resolved_at` |
| `PATCH /gaps/{id}/assign` | _writer | Mirrors `vs/findings/{id}/assign` |
| `GET/POST /policies` · `POST /policies/{id}/versions` · `POST /policies/{id}/ack` · `GET /policies/templates` | user/_writer | Templates = global rows cloned into org on use. Publishing a version emits evidence + trail. Ack upserts `CaPolicyAck` |
| `GET/POST /audits` · `PATCH /audits/{id}` | _admin | Audit instances + scope |
| `POST /audits/{id}/grants` · `DELETE .../grants/{gid}` | _admin | Create grant → return plaintext token **once**; revoke sets `revoked_at`. Trail both |
| `GET/POST /audits/{id}/findings` | user/_writer | Auditor-raised findings tracking (org side) |
| `POST /audits/{id}/attestations` | _admin | Store cert/report (encrypted) |
| `GET /posture?framework_id=` · `GET /posture/trend?days=` | user | §4 numbers from `ca_control_states` / `ca_posture_snapshots` only |
| `POST /evaluate` | _writer | Manual "re-evaluate now" — runs collectors for the org, returns diff |
| `GET /reports/{framework_id}?format=pdf` | user | Executive summary + control-by-control evidence package (via `reports.py` `_content_to_pdf` / ReportLab); `module="ca"` added to existing report model's `Literal` |

**Auditor portal routes** (same file or `routes/ca_auditor.py`), all `Depends(get_current_auditor)`:

- `GET /auditor/me` — grant scope, audit metadata, expiry.
- `GET /auditor/controls` · `GET /auditor/controls/{id}` — **only** in-scope controls; states + evidence.
- `GET /auditor/evidence/{id}` · `.../file` — hash-verified before serving; every view trailed as `auditor.evidence_viewed`.
- `POST /auditor/findings` — the single write: raise a finding on an in-scope control.
- 404 (not 403) for out-of-scope ids — don't leak existence.

---

## 3. Evidence-collection engine

### 3.1 Where it runs (decision, flagged)

**Python, not Go.** Evaluation = SQL over existing SQLAlchemy models + rule logic; no tool execution, no network scanning. Putting it in Go would duplicate every model and mapping rule in a second language with a second DB writer. Precedent: the reporting service already does Python-side post-scan computation (`reporting/vs/ingest.py` computes SLA/composite risk). Go workers + RabbitMQ remain untouched — they keep producing the scan data CA consumes. If per-org evaluation ever gets heavy, the escape hatch is a `jobs.ca` queue consumed by a *Python* worker process (queue helpers in `utils/queue.py` already support it) — the engine is written as a pure async function so it can move without change.

Two triggers, both funneling into one function `ca/engine.py: evaluate_org(db, org_id, reason)`:

1. **Event-driven (real-time posture):** at the end of `reporting/vs/ingest.py:ingest_vs_result` and the ASM asset processors, call `await ca_engine.evaluate_org(db, org_id, reason="vs_ingest")` (guarded: no-op if org has no enabled frameworks; failure logged, never propagated — same best-effort discipline as `_notify`). This is what Vanta can't do: a critical vuln lands → the affected controls flip within seconds of scan completion.
2. **Scheduled (freshness decay):** a `_run_due_ca_evaluations` tick added to `utils/scheduler.py:scheduler_loop()` (pattern: `_run_due_vs_scans`, `SELECT ... FOR UPDATE SKIP LOCKED` on `ca_org_frameworks` with a `next_eval_at` column, default every 6h). Freshness decay only happens with time, so the tick is what expires evidence, degrades statuses, writes the daily `ca_posture_snapshots`, and re-fires notifications.

### 3.2 Evaluation cycle (per org)

```
for each enabled framework's mapped checks (deduped across frameworks — each check runs ONCE):
  1. run check.logic_key(params) → queries REAL rows (read-only) → {result, source_ref, content}
  2. insert ca_evidence (hash-stamped); mark previous evidence for (org, check) superseded
  3. materialize ca_evidence_control_links from ca_control_check_map
for each control in enabled frameworks:
  4. recompute status (§4.1) from current-valid evidence over its checks
  5. on status change: update ca_control_states, write ca_audit_trail (actor=NULL)
     satisfied→gap/partial: upsert CaGap (dedup on control), dispatch CONTROL_BROKE notification
     →satisfied: auto-resolve open gap (system history row)
  6. daily: upsert ca_posture_snapshots
```

Collector registry (`ca/checks_registry.py`) — `logic_key → async fn(db, org_id, params)`. Initial automated set, all reading existing tables only:

| logic_key | Reads | Pass condition (params) |
|---|---|---|
| `vs.scan_recency` | `vs_scan_runs` | COMPLETED run within `max_age_days` (PCI quarterly: 92) |
| `vs.no_open_findings` | `vs_findings` | open count at `severity`+ ≤ `max_open` |
| `vs.remediation_sla` | `vs_findings` | % resolved within `sla_due_at` ≥ `min_pct`; no actives past due |
| `vs.scan_coverage` | `assets`+`vs_scan_runs`/`vs_scan_targets` | % active assets scanned in `window_days` ≥ `min_pct` |
| `vs.rescan_after_remediation` | `vs_finding_history`+`vs_scan_runs` | remediated→verified backed by a later run (PCI 11.3.1.1) |
| `scan_config.continuous_schedule` | `vs_scans`/`asm_discoveries` | ≥1 active INTERVAL/CRON schedule, `next_run_at` in future |
| `asm.inventory_maintained` | `assets` | >0 active assets; inventory touched within `max_age_days` |
| `asm.ownership_verified` | `assets` | % `ownership_verified` ≥ `min_pct` |
| `asm.exposure_review` | `asm_ports`/`asm_ips` | no unreviewed critical exposures older than `max_age_days` |
| `audit.trail_active` | `audit_logs` | org actions logged within window (proves logging control operative) |
| `audit.access_reviews` | `audit_logs` (`member.*` actions) | role changes/invites all trailed; review actions present within `review_days` |
| `policy.active_and_acked` | `ca_policies`/`ca_policy_acks` | active policy `key`, unexpired review, ack-rate ≥ `min_pct` |

Manual checks (`collection="manual"`, e.g. "pen test report", "BCP test", DPDP consent-manager docs) pass only while a non-expired manual evidence row exists — the tick flips them to stale at `valid_until` and notifies the owner to re-collect.

**Failing checks also produce evidence** (`result="fail"`, source_ref to the offending rows, e.g. the 3 open criticals). Gap analysis then shows *exactly what's missing* with links to real findings — not just "control failed."

### 3.3 Notifications

Add `CONTROL_BROKE`, `CONTROL_RESTORED`, `EVIDENCE_EXPIRING` to `notificationservice/events.py` + `RULE_FOR_EVENT` entries; engine calls `dispatcher.dispatch(...)` after persisting (best-effort, exactly like `ingest.py:_notify`). Jira/SIEM fan-out via existing `integrations.py` for `CONTROL_BROKE` on critical controls.

---

## 4. Compliance-posture algorithm (exact, transparent)

### 4.1 Control status from checks

For control C with mapped checks partitioned into `required` and `supporting` (`ca_control_check_map.required`), using only evidence with `status='valid'` and `valid_until > now()`:

- **satisfied** — every required check has a passing, fresh evidence row (weights: all required weight satisfied).
- **partial** — ≥1 required check passes fresh, but not all; or all required pass while a supporting check fails.
- **gap** — zero required checks pass (fails or expired evidence on all).
- **unknown** — no evidence has ever been collected for any required check (early-stage honesty state).
- **not_applicable** — manual, justification + scope mandatory, admin-only, audit-trailed. Automated evaluation skips N/A controls but keeps collecting evidence so un-marking N/A is instant.

Expired ≠ passing: evidence past `valid_until` is treated as absent (a satisfied control decays to partial/gap purely by time — this is the continuous-monitoring guarantee).

### 4.2 Per-framework score

```
A = controls in framework − not_applicable          (applicable set)
score = floor( (satisfied + 0.5 × partial) / |A| × 100 )      ; |A|=0 → score undefined, UI shows "—"
```

- `unknown` and `gap` are in the denominator at weight 0 — an org that enabled SOC 2 yesterday sees ~0%, which is the truth.
- `partial` at exactly 0.5 — fixed, documented, and shown in the UI legend; no tunable weights that could be gamed upward.
- **floor()**, never round: 89.9% is 89%, not 90%.
- The API always returns the raw counts `{satisfied, partial, gap, unknown, not_applicable, applicable}` next to the score; the UI must render them (no naked percentage anywhere).

### 4.3 Cross-framework counting (no double-count)

Scores are computed **per framework over that framework's own applicable control set**. A shared check (e.g. `vs.scan_recency`) feeds many controls, but each control is counted once inside its own framework's denominator — overlap affects *evidence reuse*, never *score math*. The combined multi-framework view is the list of per-framework scores plus a "unique checks passing / total unique checks" statistic — we deliberately do **not** average framework percentages into one blended number (it would be meaningless and inflatable by enabling an easy framework).

---

## 5. Cross-framework mapping design

- Evidence attaches to **checks** (canonical layer), never directly to controls. `ca_control_check_map` fans one check out to every control it satisfies across all frameworks, each link carrying a human-readable `rationale` displayed in the control detail UI ("This control is satisfied by *Quarterly vulnerability scan* because PCI-DSS 11.3.1 requires internal scans every three months").
- Collection is **deduped by check**: the engine builds `set(checks across all enabled frameworks)` per cycle; enabling ISO 27001 after SOC 2 costs zero re-collection for shared checks — controls light up instantly from existing evidence ("collect once, apply everywhere", the Vanta "common controls" model but powered by our own scanner).
- Freshness is also per check: one refresh updates every linked control in every framework atomically.
- The strictest framework wins parameters: where PCI requires quarterly but ISO accepts annual, seed **two checks** (`vs.scan_recency.quarterly`, `vs.scan_recency.annual`) mapped respectively — never weaken a check to make overlap prettier (flagged: silently loosening params would fabricate compliance).
- Seed mappings ship in the framework JSON files (`checks:[...]`, `controls:[{..., check_keys:[...]}]`) validated by the loader: every automated `logic_key` must exist in the registry; unknown keys fail the load (no silently dead controls).

Framework/control/check catalogs are **data**, seeded from `backend/api_service/data/frameworks/*.json` (`soc2_2017.json`, `iso27001_2022.json`, `pci_dss_4.json`, `gdpr.json`, `hipaa.json`, `dpdp_2023.json`, `cert_in_2022.json`, `nist_csf_2.json`, `cis_v8.json`) by an idempotent loader (`scripts/load_frameworks.py`, upsert on `(key, version)` + `(framework, control_ref)`, records `source_checksum`). Updating a framework version = new JSON + reload; nothing hardcoded.

---

## 6. Frontend structure (React/TS, existing design system)

New module mirrors VS layout exactly: page shell + tab components, `useEffect`+`useState` fetch pattern (matching the codebase — TanStack Query is installed but unused), `canWrite` threading, shadcn/ui primitives.

```
src/lib/services/ca.ts            # apiFetch<T> wrappers, Paginated<T>, all CA types (string-literal unions)
src/pages/app/CompliancePage.tsx  # tab shell: Dashboard | Controls | Evidence | Gaps | Policies | Audits
src/components/ca/
  CADashboard.tsx        # StatCard KPI row (per-framework score + counts), RiskGauge for selected framework,
                         # Recharts AreaChart posture trend (ca_posture_snapshots), "recently broken controls" list
  FrameworkPicker.tsx    # enable/pause frameworks (admin), target dates, per-framework score chips
  ControlsTable.tsx      # filterable (framework/status/category) paginated table; status pills reuse
                         # SeverityBadge token map: satisfied→success, partial→warning, gap→destructive,
                         # unknown→muted ("Not assessed"), N/A→accent
  ControlDetailSheet.tsx # shadcn Sheet (VS finding-detail idiom): description, evidence list with source links
                         # (evidence.source_ref → deep link to VS finding / scan run / asset), check rationale,
                         # freshness countdown, related controls in other frameworks, N/A Dialog (justification)
  EvidenceTable.tsx      # collection badge (automated/manual — always visible), freshness state, upload Dialog,
                         # hash display, file download
  GapAnalysis.tsx        # summary tiles by status/severity + table; per-gap "what's missing" from gaps.missing
  RemediationBoard.tsx   # clone of VSRemediation: NEXT_STEP forward map, STATUS_LABEL, SLA display
                         # (critical 24h→7d ladder consistent with VS), justification Dialog, assign Select
  PolicyManager.tsx      # template gallery → clone, markdown editor, version publish, ack tracking Progress bar
  AuditManager.tsx       # audit instances, scope picker, grant creation (token shown once in Dialog), attestations
src/pages/AuditorPortal.tsx       # public route /auditor?token=…: token → sessionStorage, dedicated fetch wrapper
                                  # (NOT supabase apiFetch), minimal read-only layout: in-scope controls, evidence
                                  # viewer, "raise finding" form. No sidebar/app chrome.
```

Design-system reuse: `bg-card rounded-2xl border border-border shadow-sm` cards, `font-heading` headers, framer-motion fades, `StatCard`/`RiskGauge`/`EmptyState` from `components/asm/`, Recharts via existing `ui/chart.tsx`, CSV export via `lib/csv.ts`. Dashboard always renders counts beside percentages (honesty rule) and an explicit "X controls not yet assessed" callout — an empty org shows `EmptyState` + 0%, never a spinner pretending data exists.

The existing `VSCompliance.tsx` tab (severity-mapped compliance hints inside VS) stays untouched; once CA ships it gains a "Open Compliance module →" link and is retired in a later release.

---

## 7. Integration verification (nothing breaks, nothing duplicates)

**Reads (all read-only, org-scoped via `scope_to_org`):** `assets`, `vs_findings`, `vs_scan_runs`, `vs_scan_targets`, `vs_scans`, `vs_finding_history`, `asm_discoveries`, `asm_ports`/`asm_ips`/`asm_subdomains`, `audit_logs`. CA never writes any of these tables, never creates assets, never mutates findings. No parallel stores: no CA asset table, no CA copy of findings — `source_ref` points at the originals.

**Additive-only touchpoints in existing code (each a few lines, behind try/except best-effort):**
1. `main.py` — register `ca.router` (+ `import models.ca_models` in `migrations/env.py`).
2. `utils/scheduler.py` — one `_run_due_ca_evaluations(...)` call in the loop (isolated try/except like existing steps).
3. `reporting/vs/ingest.py` + ASM asset processors — one post-persist `evaluate_org` hook (failure logged, ingest unaffected).
4. `notificationservice/events.py` — three new event constants + `RULE_FOR_EVENT` entries.
5. `routes/reports.py` — add `"ca"` to the `Module` Literal + a CA content builder branch.

No existing endpoint changes shape; Supabase auth untouched (CA uses the existing `supabase_auth.py` guards; auditor tokens live entirely inside new `/ca/auditor/*` routes). Go workers and queue topology completely untouched. Regression gate before merge: existing ASM/VS API tests + a smoke run of `jobs.vs → report.vs → ingest` must pass with CA installed but no framework enabled (CA idle = zero behavior change).

---

## 8. Phased build plan

**Phase 1 — Models & migration.** `models/ca_models.py`, `schemas/ca_schema.py`, Alembic migration `ca_module` (down_revision = current head), `REVOKE UPDATE/DELETE` on trail+evidence, env.py imports. *Exit:* `alembic upgrade head` clean; ASM/VS tests green.

**Phase 2 — Framework data.** Seed JSONs (start SOC 2 + PCI-DSS + ISO 27001; then GDPR/HIPAA/DPDP/CERT-In; NIST CSF/CIS as `is_reference`), checks + mappings with rationales, `scripts/load_frameworks.py` with registry validation. *Exit:* catalog queryable; every automated check key resolves.

**Phase 3 — Engine.** `ca/checks_registry.py` collectors (table §3.2), `ca/engine.py` evaluate/status/gap/snapshot logic, scheduler tick, ingest hooks, notifications, hash-chain trail helper. *Exit:* enable SOC 2 on a real org → statuses/evidence/gaps appear from real scan data; kill a schedule → control degrades on next tick; new critical vuln → CONTROL_BROKE within one ingest.

**Phase 4 — Routes.** `routes/ca.py` full surface (§2) incl. evidence upload encryption, transitions, posture endpoints, PDF report branch. *Exit:* OpenAPI complete; RBAC matrix tested (reader 403 on writes; no-org 403).

**Phase 5 — Frontend.** `ca.ts` service + all §6 components, wired into nav. *Exit:* dashboard shows real posture incl. honest 0%/unknown states; evidence deep-links resolve to real VS/ASM records.

**Phase 6 — Auditor portal & audits.** Grants, `get_current_auditor`, `/ca/auditor/*`, portal page, evidence package export with hash re-verification, attestation storage. *Exit:* auditor token sees only in-scope data, gets 404 out-of-scope, every access trailed.

**Real-data checklist (no placeholder survives):** framework scores ← `ca_control_states` only · trend charts ← `ca_posture_snapshots` (empty until day 2 — show "collecting history", not fake curves) · control statuses ← evaluator output only (seeded `unknown`) · evidence ← collector `source_ref` to live rows or real encrypted uploads · gap SLAs ← `_SLA_DAYS`-derived timestamps · policy ack % ← `ca_policy_acks` over active `member_profiles` · report PDFs ← same DB queries as the API · dashboard counts ← SQL aggregates, no cached literals. Grep-gate before each merge: no `TODO mock`, no hardcoded percentages, no `Math.random`/fixture JSON in CA paths.

---

## 9. Decision log (security / data-integrity flags)

| Decision | Implication |
|---|---|
| Checks layer between evidence and controls | Single source of truth for overlap; prevents per-framework evidence drift |
| Python engine (scheduler + ingest hooks), not Go | One DB writer, no duplicated model logic; Go plane untouched. Escape hatch: `jobs.ca` queue, engine already pure |
| Evidence insert-only + sha256 + superseded chain | Tampering detectable; export re-verifies hashes |
| DB-level REVOKE on trail/evidence + hash-chained trail | Immutability survives app bugs; tamper-evident even to DBAs |
| Auditor = opaque hashed token + dedicated dependency, never org RBAC | Leaked token ≠ platform access; least-privilege by construction |
| Overrides can't force `satisfied`; N/A needs justification+scope+admin+trail | No dashboard-driven compliance fraud |
| floor() scores, unknown-in-denominator, counts always shown | Structural anti-inflation |
| Strictest-framework check params (separate quarterly/annual checks) | Overlap never weakens a requirement |
| Manual evidence badged end-to-end; encrypted at rest (VsCredential envelope pattern) | Synthetic evidence can't pose as system-collected; confidential docs protected |
| Framework text paraphrased, not verbatim | ISO/PCI copyright compliance |

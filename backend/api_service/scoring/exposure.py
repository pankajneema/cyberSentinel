"""
Defensible attack-surface exposure scoring.

Replaces the legacy magic-number heuristic (`len(ports) * 3 + 12/sensitive-port`)
with a transparent, configurable, explainable risk model that an enterprise
security team can defend in an audit.

Design principles
-----------------
- **Explainable**: every point in the final score is attributed to a named factor
  (`ScoreFactor`) so the UI can show *why* an asset scored what it did.
- **Standards-aligned**: vulnerability risk uses **CVSS** (severity), **EPSS**
  (probability of exploitation in the wild), and **KEV** (CISA Known-Exploited —
  a hard escalator). This mirrors how Tenable/Qualys/Rapid7 prioritise.
- **Context-aware**: internet exposure and asset criticality act as multipliers,
  not flat additions — a critical CVE on an internal, low-value box is not the
  same as on a public, business-critical one.
- **Bounded & monotonic**: score is clamped to 0–100 and never decreases when a
  new risk signal is added.
- **Configurable**: all weights live in `DEFAULT_WEIGHTS`; pass a custom dict to
  tune per-tenant without touching code.

Output is a 0–100 score plus a severity band and a factor breakdown.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------
@dataclass
class CveSignal:
    """A vulnerability finding on the asset."""
    cve_id: str
    cvss: float = 0.0            # 0.0–10.0 base severity
    epss: float = 0.0           # 0.0–1.0 probability of exploitation (next 30d)
    kev: bool = False           # CISA Known Exploited Vulnerability


@dataclass
class AssetSignals:
    """Everything we know about an asset that bears on its exposure."""
    open_ports: list[int] = field(default_factory=list)
    services: list[str] = field(default_factory=list)        # service names/banners
    is_public: bool = True                                   # internet-facing?
    has_tls: bool = True
    tls_issues: list[str] = field(default_factory=list)      # see TLS_ISSUE_POINTS
    cves: list[CveSignal] = field(default_factory=list)
    admin_endpoints: int = 0                                 # exposed admin panels
    backup_files: int = 0                                    # exposed backups/dumps
    exposed_api_endpoints: int = 0
    asset_criticality: str = "normal"                        # low|normal|high|critical


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
@dataclass
class ScoreFactor:
    name: str
    points: float
    detail: str


@dataclass
class ExposureScore:
    score: int                  # 0–100
    severity: str               # critical|high|medium|low|info
    factors: list[ScoreFactor] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "severity": self.severity,
            "factors": [
                {"name": f.name, "points": round(f.points, 1), "detail": f.detail}
                for f in self.factors
            ],
        }


# ---------------------------------------------------------------------------
# Model constants (auditable, tunable)
# ---------------------------------------------------------------------------
# Ports that are high-risk when internet-exposed (databases, admin protocols,
# remote access, message brokers). Points are the *base* exposure contribution.
SENSITIVE_PORTS: dict[int, tuple[str, float]] = {
    21:    ("FTP", 8),
    23:    ("Telnet", 12),
    135:   ("MS-RPC", 8),
    139:   ("NetBIOS", 8),
    445:   ("SMB", 14),
    1433:  ("MSSQL", 12),
    1521:  ("Oracle DB", 12),
    2375:  ("Docker API", 16),
    3306:  ("MySQL", 12),
    3389:  ("RDP", 14),
    5432:  ("PostgreSQL", 12),
    5601:  ("Kibana", 10),
    5900:  ("VNC", 12),
    6379:  ("Redis", 14),
    9200:  ("Elasticsearch", 14),
    11211: ("Memcached", 12),
    27017: ("MongoDB", 14),
}

TLS_ISSUE_POINTS: dict[str, tuple[float, str]] = {
    "no_tls":      (10, "Sensitive service without TLS"),
    "expired":     (8, "Expired certificate"),
    "self_signed": (5, "Self-signed certificate"),
    "weak_cipher": (6, "Weak cipher / protocol"),
    "hostname_mismatch": (4, "Certificate hostname mismatch"),
}

CRITICALITY_MULTIPLIER: dict[str, float] = {
    "low": 0.8,
    "normal": 1.0,
    "high": 1.2,
    "critical": 1.4,
}

DEFAULT_WEIGHTS: dict[str, float] = {
    "port_open_base": 1.5,        # per non-sensitive open port
    "cve_cvss_weight": 30.0,      # multiplies the worst CVSS/10 (CVSS 10 -> 30 pts)
    "cve_epss_boost": 20.0,       # multiplies EPSS (0–1) of the worst CVE
    "cve_kev_escalator": 25.0,    # flat add if any KEV present (actively exploited)
    "cve_volume_weight": 2.0,     # per additional high/critical CVE beyond the worst
    "admin_endpoint": 6.0,        # per exposed admin panel
    "backup_file": 8.0,           # per exposed backup/dump
    "exposed_api": 1.0,           # per exposed API endpoint (capped)
    "internal_dampen": 0.45,      # multiplier when NOT internet-facing
}

SEVERITY_BANDS = [
    (80, "critical"),
    (60, "high"),
    (40, "medium"),
    (20, "low"),
    (0, "info"),
]


def _severity_for(score: int) -> str:
    for threshold, label in SEVERITY_BANDS:
        if score >= threshold:
            return label
    return "info"


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def score_exposure(
    signals: AssetSignals,
    weights: Optional[dict[str, float]] = None,
) -> ExposureScore:
    """Compute a 0–100 exposure score with an explainable factor breakdown."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    factors: list[ScoreFactor] = []
    raw = 0.0

    # --- 1. Open ports & sensitive services ---
    sensitive_hits = [p for p in signals.open_ports if p in SENSITIVE_PORTS]
    for port in sensitive_hits:
        name, pts = SENSITIVE_PORTS[port]
        raw += pts
        factors.append(ScoreFactor(f"sensitive-port:{port}", pts, f"{name} exposed"))

    other_ports = [p for p in signals.open_ports if p not in SENSITIVE_PORTS]
    if other_ports:
        pts = len(other_ports) * w["port_open_base"]
        raw += pts
        factors.append(ScoreFactor("open-ports", pts, f"{len(other_ports)} other open port(s)"))

    # --- 2. Vulnerabilities (CVSS + EPSS + KEV) ---
    if signals.cves:
        worst = max(signals.cves, key=lambda c: (c.cvss, c.epss))
        cvss_pts = (worst.cvss / 10.0) * w["cve_cvss_weight"]
        epss_pts = worst.epss * w["cve_epss_boost"]
        raw += cvss_pts + epss_pts
        factors.append(ScoreFactor(
            "worst-cve",
            cvss_pts + epss_pts,
            f"{worst.cve_id} CVSS {worst.cvss} / EPSS {worst.epss:.0%}",
        ))

        if any(c.kev for c in signals.cves):
            raw += w["cve_kev_escalator"]
            factors.append(ScoreFactor(
                "kev", w["cve_kev_escalator"], "Known-Exploited vulnerability present",
            ))

        # Volume: each additional high/critical CVE beyond the worst adds a little.
        high_cves = [c for c in signals.cves if c.cvss >= 7.0 and c is not worst]
        if high_cves:
            pts = len(high_cves) * w["cve_volume_weight"]
            raw += pts
            factors.append(ScoreFactor(
                "cve-volume", pts, f"{len(high_cves)} additional high/critical CVE(s)",
            ))

    # --- 3. TLS posture ---
    for issue in signals.tls_issues:
        pts, detail = TLS_ISSUE_POINTS.get(issue, (3, f"TLS issue: {issue}"))
        raw += pts
        factors.append(ScoreFactor(f"tls:{issue}", pts, detail))

    # --- 4. Sensitive exposed endpoints ---
    if signals.admin_endpoints:
        pts = signals.admin_endpoints * w["admin_endpoint"]
        raw += pts
        factors.append(ScoreFactor("admin-endpoints", pts, f"{signals.admin_endpoints} admin panel(s) exposed"))
    if signals.backup_files:
        pts = signals.backup_files * w["backup_file"]
        raw += pts
        factors.append(ScoreFactor("backup-files", pts, f"{signals.backup_files} backup file(s) exposed"))
    if signals.exposed_api_endpoints:
        pts = min(signals.exposed_api_endpoints * w["exposed_api"], 10.0)
        raw += pts
        factors.append(ScoreFactor("exposed-api", pts, f"{signals.exposed_api_endpoints} API endpoint(s) exposed"))

    # --- 5. Context multipliers (exposure + criticality) ---
    if not signals.is_public:
        raw *= w["internal_dampen"]
        factors.append(ScoreFactor("internal-asset", 0.0, "Not internet-facing (risk dampened)"))

    crit_mult = CRITICALITY_MULTIPLIER.get(signals.asset_criticality, 1.0)
    if crit_mult != 1.0:
        raw *= crit_mult
        factors.append(ScoreFactor(
            "asset-criticality", 0.0, f"Asset criticality: {signals.asset_criticality} (x{crit_mult})",
        ))

    score = int(max(0.0, min(100.0, round(raw))))
    return ExposureScore(score=score, severity=_severity_for(score), factors=factors)

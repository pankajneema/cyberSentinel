"""Vulnerability-scan (VS) finding -> compliance control mapping.

PURE mapping module: no DB, no network, no FastAPI, no I/O. Fully unit-testable.

Every control identifier below is a REAL, published reference. Sources:

  * NIST CSF 2.0 (Cybersecurity Framework 2.0, NIST, Feb 2024) -- Function.Category-##
    subcategory identifiers, e.g. "PR.DS-02".
  * ISO/IEC 27001:2022 Annex A -- control identifiers "A.5.x"/"A.8.x".
  * CIS Controls v8 (Center for Internet Security, 2021) -- Safeguard numbers "N.M".
  * PCI-DSS v4.0 (PCI Security Standards Council, Mar 2022) -- requirement numbers.
  * SOC 2 -- AICPA Trust Services Criteria (TSC 2017, rev. 2022) Common Criteria "CCx.y".
  * India CERT-In Directions -- reference "No.20(3)/2022-CERT-In" (28 Apr 2022) and
    the Digital Personal Data Protection Act, 2023 ("DPDP") Section 8 obligations.

Where a precise sub-control was uncertain, the mapping points at the closest real
high-level control and says so in an inline comment. No identifiers are invented.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

# ---------------------------------------------------------------------------
# Framework identifiers (stable keys used in the returned dicts)
# ---------------------------------------------------------------------------
NIST_CSF = "NIST CSF 2.0"
ISO_27001 = "ISO/IEC 27001:2022"
CIS_V8 = "CIS Controls v8"
PCI_DSS = "PCI-DSS v4.0"
SOC2 = "SOC 2 (TSC)"
CERTIN_DPDP = "CERT-In / DPDP"

FRAMEWORKS: List[str] = [NIST_CSF, ISO_27001, CIS_V8, PCI_DSS, SOC2, CERTIN_DPDP]

# CERT-In Directions reference number (issued 28 Apr 2022) -- constant reused below.
_CERTIN_DIR = "No.20(3)/2022-CERT-In"
# DPDP Act 2023, Section 8(5): the Data Fiduciary shall protect personal data by
# taking reasonable security safeguards to prevent a personal data breach.
_DPDP_SAFEGUARDS = "DPDP Sec 8(5)"


# ---------------------------------------------------------------------------
# Category -> controls. Keyed by the VS 'category' values used in the codebase:
# cve_match, misconfig, tls, service, default_creds, exposure.
# ---------------------------------------------------------------------------
CATEGORY_CONTROL_MAP: Dict[str, Dict[str, List[str]]] = {
    # Known CVE / vulnerable-version match -> technical vulnerability management.
    "cve_match": {
        NIST_CSF: ["ID.RA-01"],          # Vulnerabilities in assets are identified & recorded
        ISO_27001: ["A.8.8"],            # Management of technical vulnerabilities
        CIS_V8: ["7.1", "7.5"],          # Vuln-mgmt process; automated vuln scans
        PCI_DSS: ["6.3.1", "11.3.1"],    # Vulns identified/managed; internal vuln scans
        SOC2: ["CC7.1"],                 # Detect new vulnerabilities
        CERTIN_DPDP: [_CERTIN_DIR, _DPDP_SAFEGUARDS],
    },
    # Security misconfiguration.
    "misconfig": {
        NIST_CSF: ["PR.PS-01"],          # Configuration management practices established/applied
        ISO_27001: ["A.8.9"],            # Configuration management
        CIS_V8: ["4.1"],                 # Establish & maintain a secure configuration process
        PCI_DSS: ["2.2.1"],              # Configuration standards developed/implemented
        SOC2: ["CC7.1"],                 # Detect configuration changes/deviations
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
    # TLS/SSL weaknesses (weak ciphers, expired/invalid certs, downgrade).
    "tls": {
        NIST_CSF: ["PR.DS-02"],          # Data-in-transit is protected
        ISO_27001: ["A.8.24"],           # Use of cryptography
        CIS_V8: ["3.10"],                # Encrypt sensitive data in transit
        PCI_DSS: ["4.2.1"],              # Strong cryptography/protocols for transmission
        SOC2: ["CC6.7"],                 # Transmission of data is encrypted
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
    # Exposed network service / open port.
    "service": {
        NIST_CSF: ["PR.IR-01"],          # Networks/environments protected from unauthorized access
        ISO_27001: ["A.8.20", "A.8.21"], # Networks security; security of network services
        CIS_V8: ["4.8", "12.2"],         # Disable unnecessary services; secure network architecture
        PCI_DSS: ["2.2.4", "1.2.1"],     # Only necessary services enabled; NSC config standards
        SOC2: ["CC6.6"],                 # Boundary protection against external threats
        CERTIN_DPDP: [_CERTIN_DIR, _DPDP_SAFEGUARDS],
    },
    # Default / well-known / weak credentials.
    "default_creds": {
        NIST_CSF: ["PR.AA-01"],          # Identities and credentials are managed
        ISO_27001: ["A.5.17", "A.8.5"],  # Authentication information; secure authentication
        CIS_V8: ["4.7", "5.2"],          # Manage default accounts; use unique passwords
        PCI_DSS: ["2.2.2", "8.3.1"],     # Vendor default accounts managed; strong authentication
        SOC2: ["CC6.1"],                 # Logical access -- credentials/authentication
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
    # Data / asset exposure (sensitive data or surface exposed).
    "exposure": {
        NIST_CSF: ["PR.DS-01"],          # Data-at-rest is protected (confidentiality)
        ISO_27001: ["A.8.12"],           # Data leakage prevention
        CIS_V8: ["3.3"],                 # Configure data access control lists
        PCI_DSS: ["7.2.1"],              # Access control model (need-to-know)
        SOC2: ["CC6.1"],                 # Logical access controls restrict access
        CERTIN_DPDP: [_CERTIN_DIR, _DPDP_SAFEGUARDS],
    },
}


# ---------------------------------------------------------------------------
# CWE -> controls. Keyed by canonical "CWE-###" ids.
# ---------------------------------------------------------------------------

# Shared secure-coding control set (applies to injection/XSS/CSRF/traversal classes).
# NIST CSF 2.0 PR.PS-06: secure software development practices integrated across the SDLC.
# PCI-DSS 6.2.4 explicitly enumerates injection, XSS, and CSRF as attacks to prevent.
# SOC 2 CC8.1: change management covers secure development/testing before deployment.
_SECURE_CODING: Dict[str, List[str]] = {
    NIST_CSF: ["PR.PS-06"],
    ISO_27001: ["A.8.28"],   # Secure coding
    CIS_V8: ["16.1"],        # Establish & maintain a secure application development process
    PCI_DSS: ["6.2.4"],
    SOC2: ["CC8.1"],
    CERTIN_DPDP: [_DPDP_SAFEGUARDS],
}

CWE_CONTROL_MAP: Dict[str, Dict[str, List[str]]] = {
    # CWE-79: Cross-site Scripting (XSS).
    "CWE-79": dict(_SECURE_CODING),
    # CWE-89: SQL Injection.
    "CWE-89": dict(_SECURE_CODING),
    # CWE-352: Cross-Site Request Forgery (CSRF).
    "CWE-352": dict(_SECURE_CODING),
    # CWE-22: Path Traversal. Secure-coding class plus an access-control angle.
    "CWE-22": {
        NIST_CSF: ["PR.PS-06", "PR.AA-05"],  # Secure SDLC; access permissions/authorizations
        ISO_27001: ["A.8.28", "A.8.3"],      # Secure coding; information access restriction
        CIS_V8: ["16.1", "3.3"],             # Secure app dev; data access control lists
        PCI_DSS: ["6.2.4", "7.2.1"],         # Prevent common attacks; access control model
        SOC2: ["CC8.1", "CC6.1"],            # Change mgmt; logical access controls
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
    # CWE-287: Improper Authentication.
    "CWE-287": {
        NIST_CSF: ["PR.AA-03", "PR.AA-01"],  # Users/services authenticated; credentials managed
        ISO_27001: ["A.8.5", "A.5.17"],      # Secure authentication; authentication information
        CIS_V8: ["6.3", "6.4"],              # MFA for externally-exposed apps; MFA for remote access
        PCI_DSS: ["8.3.1"],                  # Strong authentication for users/administrators
        SOC2: ["CC6.1"],                     # Logical access -- authentication
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
    # CWE-798: Use of Hard-coded Credentials.
    "CWE-798": {
        NIST_CSF: ["PR.AA-01"],              # Identities and credentials are managed
        ISO_27001: ["A.5.17", "A.8.24"],     # Authentication information; cryptography/key mgmt
        CIS_V8: ["5.2", "16.1"],             # Unique passwords; secure app development
        PCI_DSS: ["8.6.2"],                  # Passwords/passphrases not hard-coded in scripts/config
        SOC2: ["CC6.1"],                     # Logical access -- credential management
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
    # CWE-327: Use of a Broken or Risky Cryptographic Algorithm.
    "CWE-327": {
        # CSF 2.0 has no dedicated crypto subcategory; data-protection subcategories apply.
        NIST_CSF: ["PR.DS-01", "PR.DS-02"],  # Protect data at rest & in transit
        ISO_27001: ["A.8.24"],               # Use of cryptography
        CIS_V8: ["3.10", "3.11"],            # Encrypt in transit; encrypt at rest
        PCI_DSS: ["4.2.1", "6.2.4"],         # Strong crypto in transit; prevent crypto weaknesses
        SOC2: ["CC6.7", "CC6.1"],            # Encrypted transmission; logical access protections
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
    # CWE-311: Missing Encryption of Sensitive Data.
    "CWE-311": {
        NIST_CSF: ["PR.DS-01", "PR.DS-02"],  # Protect data at rest & in transit
        ISO_27001: ["A.8.24"],               # Use of cryptography
        CIS_V8: ["3.11", "3.10"],            # Encrypt at rest; encrypt in transit
        PCI_DSS: ["3.5.1", "4.2.1"],         # Render stored PAN unreadable; strong crypto in transit
        SOC2: ["CC6.1", "CC6.7"],            # Logical access protections; encrypted transmission
        CERTIN_DPDP: [_DPDP_SAFEGUARDS],
    },
}


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------
_CWE_RE = re.compile(r"(\d+)")

# Severity buckets recognized for rollups (order = descending seriousness).
SEVERITIES: List[str] = ["critical", "high", "medium", "low", "info"]

# A finding is considered resolved (NOT open) when its status is one of these.
# Anything else -- including "open", None, or an unrecognized value -- is treated
# as OPEN, so unknown statuses are never silently dropped from coverage.
_CLOSED_STATUSES = frozenset(
    {"closed", "resolved", "fixed", "remediated", "mitigated",
     "accepted", "risk_accepted", "false_positive", "ignored", "wont_fix"}
)


def _normalize_cwe(value: object) -> Optional[str]:
    """Return a canonical 'CWE-###' string, or None if no CWE number is present."""
    if value is None:
        return None
    match = _CWE_RE.search(str(value))
    if not match:
        return None
    return f"CWE-{int(match.group(1))}"


def _extract_cwes(finding: dict) -> List[str]:
    """Pull canonical CWE ids from a finding dict (cwe_ids list or cwe scalar)."""
    raw: List[object] = []
    cwe_ids = finding.get("cwe_ids")
    if isinstance(cwe_ids, (list, tuple, set)):
        raw.extend(cwe_ids)
    elif cwe_ids is not None:
        raw.append(cwe_ids)
    if finding.get("cwe") is not None:
        raw.append(finding["cwe"])

    out: List[str] = []
    for item in raw:
        norm = _normalize_cwe(item)
        if norm and norm not in out:
            out.append(norm)
    return out


def _normalize_severity(value: object) -> str:
    sev = str(value).strip().lower() if value is not None else ""
    if sev in ("informational", "information", "none"):
        sev = "info"
    return sev if sev in SEVERITIES else "unknown"


def _is_open(finding: dict) -> bool:
    status = finding.get("status")
    if status is None:
        return True  # no status -> treat as open (conservative, never fabricated)
    return str(status).strip().lower() not in _CLOSED_STATUSES


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def map_finding_to_controls(
    category: str,
    cwe_ids: Optional[List[str]] = None,
) -> Dict[str, List[str]]:
    """Map a single finding to compliance controls per framework.

    Args:
        category: one of the VS categories (cve_match, misconfig, tls, service,
            default_creds, exposure). Unknown categories contribute nothing.
        cwe_ids: optional list of CWE identifiers (any of "CWE-79", "79", "cwe-79").

    Returns:
        {framework: [control_ids]} -- the deduped union of the category mapping
        and every recognized CWE mapping. Every framework key is always present
        (with a possibly-empty list) so callers get a stable shape.
    """
    result: Dict[str, List[str]] = {fw: [] for fw in FRAMEWORKS}

    sources: List[Dict[str, List[str]]] = []
    if category is not None:
        cat_map = CATEGORY_CONTROL_MAP.get(str(category).strip().lower())
        if cat_map:
            sources.append(cat_map)

    for raw_cwe in cwe_ids or []:
        norm = _normalize_cwe(raw_cwe)
        if norm and norm in CWE_CONTROL_MAP:
            sources.append(CWE_CONTROL_MAP[norm])

    for mapping in sources:
        for fw, controls in mapping.items():
            bucket = result[fw]
            for control in controls:
                if control not in bucket:
                    bucket.append(control)

    for fw in result:
        result[fw].sort()
    return result


def compliance_summary(findings: List[dict]) -> Dict:
    """Roll up a list of VS findings into a per-framework compliance picture.

    Only OPEN findings (see `_is_open`) contribute to control coverage. An empty
    or all-resolved input yields honest zeroed structures -- coverage is never
    fabricated.

    Each finding dict may carry: category, cwe_ids (list) / cwe (scalar) / cve,
    severity, status.

    Returns a dict::

        {
          "total_findings": int,          # all findings received
          "open_findings": int,           # findings counted as open
          "severity_counts": {sev: int},  # open findings by severity (overall)
          "frameworks": {
             <framework>: {
                "controls": {
                   <control_id>: {
                      "open_findings": int,
                      "severity_counts": {sev: int},
                   }, ...
                },
                "open_control_count": int,
                "severity_counts": {sev: int},   # open findings touching this framework
             }, ...
          },
          "coverage": [ "<framework>::<control_id>", ... ],  # sorted, deduped
        }
    """
    def _empty_sev() -> Dict[str, int]:
        return {sev: 0 for sev in SEVERITIES + ["unknown"]}

    frameworks: Dict[str, Dict] = {
        fw: {"controls": {}, "open_control_count": 0, "severity_counts": _empty_sev()}
        for fw in FRAMEWORKS
    }
    overall_sev = _empty_sev()
    open_count = 0

    findings = findings or []
    for finding in findings:
        if not isinstance(finding, dict) or not _is_open(finding):
            continue
        open_count += 1
        severity = _normalize_severity(finding.get("severity"))
        overall_sev[severity] += 1

        mapped = map_finding_to_controls(
            finding.get("category"), _extract_cwes(finding)
        )
        for fw, controls in mapped.items():
            if not controls:
                continue
            fw_block = frameworks[fw]
            fw_touched = False
            for control in controls:
                entry = fw_block["controls"].get(control)
                if entry is None:
                    entry = {"open_findings": 0, "severity_counts": _empty_sev()}
                    fw_block["controls"][control] = entry
                entry["open_findings"] += 1
                entry["severity_counts"][severity] += 1
                fw_touched = True
            if fw_touched:
                # Count this open finding once per framework it maps into.
                fw_block["severity_counts"][severity] += 1

    coverage: List[str] = []
    for fw in FRAMEWORKS:
        fw_block = frameworks[fw]
        fw_block["open_control_count"] = len(fw_block["controls"])
        for control in sorted(fw_block["controls"]):
            coverage.append(f"{fw}::{control}")

    return {
        "total_findings": len(findings),
        "open_findings": open_count,
        "severity_counts": overall_sev,
        "frameworks": frameworks,
        "coverage": coverage,
    }

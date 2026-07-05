"""
VS composite risk score — combines CVSS + EPSS + KEV + asset exposure +
criticality + finding confidence into a single explainable 0..100 score.

This does NOT rank by CVSS alone (Domain 4). It mirrors the platform's exposure
model weighting so VS risk and ASM exposure are one coherent system, and every
input is returned as a transparent factor for the UI "why this score" panel.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RiskFactor:
    name: str
    points: float
    detail: str


@dataclass
class VsRisk:
    score: int                    # 0..100
    severity: str                 # critical|high|medium|low|info
    factors: list[RiskFactor]

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "severity": self.severity,
            "factors": [{"name": f.name, "points": f.points, "detail": f.detail} for f in self.factors],
        }


# Baseline threat (0..1) used ONLY when a finding carries no CVE intelligence
# (no CVSS, no EPSS, not KEV) — e.g. a default-credential/misconfig finding whose
# only signal is the scanner engine's own severity. Keeps such findings from
# collapsing to score 0 / "info".
_RAW_SEV_BASELINE = {"critical": 0.90, "high": 0.70, "medium": 0.45, "low": 0.20, "info": 0.05}
_EXPOSURE_MULT = {"public": 1.30, "internal": 0.80}
_CRIT_MULT = {"critical": 1.40, "high": 1.20, "normal": 1.00, "low": 0.80}
_CONFIDENCE_FACTOR = {"confirmed": 1.00, "firm": 0.85, "tentative": 0.60}
# threat-component weights (sum of the CVSS/EPSS/KEV contributions)
_W_CVSS, _W_EPSS, _W_KEV = 0.50, 0.30, 0.20


def _severity_for(score: int) -> str:
    if score >= 90:
        return "critical"
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    if score >= 15:
        return "low"
    return "info"


def compute_vs_risk(
    *,
    cvss_base: float | None,
    epss: float | None,
    kev: bool,
    exposure: str = "internal",       # assets.exposure: public|internal
    criticality: str = "normal",      # low|normal|high|critical
    confidence: str = "tentative",    # tentative|firm|confirmed
    raw_severity: str | None = None,  # engine-reported severity; fallback when no CVE intel
) -> VsRisk:
    cvss = max(0.0, min(10.0, float(cvss_base or 0.0)))
    epss_v = max(0.0, min(1.0, float(epss or 0.0)))
    factors: list[RiskFactor] = []

    cvss_pts = _W_CVSS * (cvss / 10.0)
    factors.append(RiskFactor("cvss", round(cvss_pts * 100, 1), f"CVSS base {cvss:.1f}"))
    epss_pts = _W_EPSS * epss_v
    factors.append(RiskFactor("epss", round(epss_pts * 100, 1),
                              f"EPSS {epss_v:.2%} exploitation probability (30d)"))
    kev_pts = _W_KEV if kev else 0.0
    factors.append(RiskFactor("kev", round(kev_pts * 100, 1),
                              "On CISA KEV — actively exploited" if kev else "Not on CISA KEV"))

    threat = cvss_pts + epss_pts + kev_pts   # 0..1

    # No CVE intelligence at all (no CVSS/EPSS/KEV): fall back to the scanner
    # engine's own severity so findings like default credentials or misconfigs
    # are scored on their reported severity instead of collapsing to 0/"info".
    if threat <= 0.0 and raw_severity:
        base = _RAW_SEV_BASELINE.get(str(raw_severity).strip().lower())
        if base is not None:
            threat = base
            factors.append(RiskFactor("engine-severity", round(base * 100, 1),
                                      f"No CVE intelligence — engine-reported "
                                      f"{str(raw_severity).strip().lower()} severity"))

    exp = (exposure or "internal").lower()
    exposure_mult = _EXPOSURE_MULT.get(exp, 0.80)
    crit = (criticality or "normal").lower()
    crit_mult = _CRIT_MULT.get(crit, 1.00)
    conf = (confidence or "tentative").lower()
    conf_factor = _CONFIDENCE_FACTOR.get(conf, 0.60)

    raw = threat * 100.0 * exposure_mult * crit_mult * conf_factor
    score = int(max(0.0, min(100.0, round(raw))))

    factors.append(RiskFactor("exposure", 0.0, f"{exp} asset (×{exposure_mult})"))
    factors.append(RiskFactor("criticality", 0.0, f"{crit} criticality (×{crit_mult})"))
    factors.append(RiskFactor("confidence", 0.0, f"{conf} finding (×{conf_factor})"))

    # KEV on an internet-facing asset = active exploitation of an exposed target:
    # force top priority regardless of the multiplicative math.
    if kev and exp == "public":
        if score < 90:
            factors.append(RiskFactor("kev-public-floor", float(90 - score),
                                      "KEV on internet-facing asset — floored to 90"))
        score = max(score, 90)

    return VsRisk(score=score, severity=_severity_for(score), factors=factors)

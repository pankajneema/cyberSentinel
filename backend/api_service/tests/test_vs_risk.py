"""Unit tests for the VS composite risk score (CVSS+EPSS+KEV+context)."""
from scoring.vs_risk import compute_vs_risk


def test_low_cvss_internal_is_low():
    r = compute_vs_risk(cvss_base=3.1, epss=0.01, kev=False,
                        exposure="internal", criticality="normal", confidence="firm")
    assert r.severity in ("info", "low")
    assert 0 <= r.score <= 40


def test_kev_public_floors_to_critical():
    # KEV on an internet-facing asset must be forced to top priority.
    r = compute_vs_risk(cvss_base=6.0, epss=0.2, kev=True,
                        exposure="public", criticality="normal", confidence="confirmed")
    assert r.score >= 90 and r.severity == "critical"
    assert any(f.name == "kev-public-floor" or f.name == "kev" for f in r.factors)


def test_exposure_and_criticality_raise_score():
    base = compute_vs_risk(cvss_base=8.0, epss=0.3, kev=False,
                           exposure="internal", criticality="low", confidence="confirmed").score
    hot = compute_vs_risk(cvss_base=8.0, epss=0.3, kev=False,
                          exposure="public", criticality="critical", confidence="confirmed").score
    assert hot > base   # public + critical outranks internal + low for the same CVE


def test_confidence_discounts_unverified():
    firm = compute_vs_risk(cvss_base=9.0, epss=0.5, kev=False, confidence="confirmed").score
    tentative = compute_vs_risk(cvss_base=9.0, epss=0.5, kev=False, confidence="tentative").score
    assert tentative < firm   # unconfirmed findings are discounted


def test_factors_are_explainable():
    r = compute_vs_risk(cvss_base=9.8, epss=0.9, kev=True, exposure="public")
    names = {f.name for f in r.factors}
    assert {"cvss", "epss", "kev", "exposure", "criticality", "confidence"} <= names
    assert r.to_dict()["severity"] == r.severity


# --- no-CVE findings fall back to engine severity (weak-credential path) ---

def test_raw_severity_fallback_when_no_cve_intel():
    from scoring.vs_risk import compute_vs_risk
    # No CVSS/EPSS/KEV — must NOT collapse to info; uses engine severity.
    r = compute_vs_risk(cvss_base=None, epss=None, kev=False,
                        exposure="public", criticality="normal", confidence="confirmed",
                        raw_severity="critical")
    assert r.score >= 90 and r.severity == "critical"   # critical default-cred on public asset
    assert any(f.name == "engine-severity" for f in r.factors)


def test_raw_severity_ignored_when_cve_present():
    from scoring.vs_risk import compute_vs_risk
    # With a real CVSS, the CVE math wins and raw_severity is NOT used.
    r_with = compute_vs_risk(cvss_base=9.8, epss=0.5, kev=True,
                             exposure="public", confidence="confirmed", raw_severity="low")
    r_without = compute_vs_risk(cvss_base=9.8, epss=0.5, kev=True,
                                exposure="public", confidence="confirmed")
    assert r_with.score == r_without.score            # raw_severity had no effect
    assert not any(f.name == "engine-severity" for f in r_with.factors)


def test_no_raw_severity_still_zero():
    from scoring.vs_risk import compute_vs_risk
    # Backward-compat: no CVE intel AND no raw_severity => unchanged (info/0).
    r = compute_vs_risk(cvss_base=None, epss=None, kev=False)
    assert r.score == 0 and r.severity == "info"


def test_internal_default_cred_is_high_not_critical():
    from scoring.vs_risk import compute_vs_risk
    r = compute_vs_risk(cvss_base=None, epss=None, kev=False,
                        exposure="internal", confidence="confirmed", raw_severity="critical")
    # 0.90 * 0.80(internal) * 1.0(confirmed) * 100 = 72 => high
    assert r.severity == "high"

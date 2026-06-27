"""Tests for the defensible exposure-scoring model."""

from scoring.exposure import (
    AssetSignals,
    CveSignal,
    score_exposure,
    SENSITIVE_PORTS,
)


def test_clean_internal_asset_scores_low():
    s = score_exposure(AssetSignals(open_ports=[443], is_public=False, asset_criticality="low"))
    assert s.score <= 20
    assert s.severity in ("info", "low")


def test_exposed_database_is_high_or_critical():
    s = score_exposure(AssetSignals(open_ports=[27017, 6379, 9200], is_public=True))
    assert s.score >= 40
    # every point is attributed
    assert any("sensitive-port:27017" in f.name for f in s.factors)


def test_kev_cve_escalates_to_critical():
    s = score_exposure(
        AssetSignals(
            open_ports=[443],
            is_public=True,
            cves=[CveSignal("CVE-2024-1234", cvss=9.8, epss=0.9, kev=True)],
            asset_criticality="critical",
        )
    )
    assert s.score >= 80
    assert s.severity == "critical"
    assert any(f.name == "kev" for f in s.factors)


def test_internet_exposure_scores_higher_than_internal():
    base = dict(open_ports=[3389, 445], cves=[CveSignal("CVE-1", cvss=8.0, epss=0.3)])
    public = score_exposure(AssetSignals(is_public=True, **base)).score
    internal = score_exposure(AssetSignals(is_public=False, **base)).score
    assert public > internal


def test_score_is_bounded_0_100():
    s = score_exposure(
        AssetSignals(
            open_ports=list(SENSITIVE_PORTS.keys()),
            is_public=True,
            tls_issues=["no_tls", "expired", "weak_cipher"],
            cves=[CveSignal(f"CVE-{i}", cvss=10.0, epss=1.0, kev=True) for i in range(20)],
            admin_endpoints=5,
            backup_files=5,
            asset_criticality="critical",
        )
    )
    assert 0 <= s.score <= 100
    assert s.score == 100


def test_monotonic_adding_risk_never_decreases():
    a = score_exposure(AssetSignals(open_ports=[443], is_public=True)).score
    b = score_exposure(AssetSignals(open_ports=[443, 3389], is_public=True)).score
    assert b >= a


def test_explainability_factors_present():
    s = score_exposure(AssetSignals(open_ports=[445], is_public=True, backup_files=1))
    names = [f.name for f in s.factors]
    assert "sensitive-port:445" in names
    assert "backup-files" in names

"""Cross-engine correlation helpers (pure) — false-positive reduction (Domain 7)."""
from scoring.vs_correlation import (
    build_corroboration, corroborated_confidence, confidence_rank,
)


def test_corroboration_map_groups_by_asset_port_engine():
    findings = [
        {"asset_id": "a1", "location": {"port": 443}, "source_engine": "nuclei"},
        {"asset_id": "a1", "location": {"port": 443}, "source_engine": "sslyze"},
        {"asset_id": "a1", "location": {"port": 80}, "source_engine": "nuclei"},
    ]
    m = build_corroboration(findings)
    assert m[("a1", "443")] == {"nuclei", "sslyze"}   # two engines => corroborated
    assert m[("a1", "80")] == {"nuclei"}              # one engine


def test_same_engine_twice_is_not_corroboration():
    findings = [
        {"asset_id": "a1", "location": {"port": 443}, "source_engine": "nuclei"},
        {"asset_id": "a1", "location": {"port": 443}, "source_engine": "nuclei"},
    ]
    assert build_corroboration(findings)[("a1", "443")] == {"nuclei"}  # de-duped -> 1


def test_missing_engine_is_ignored():
    findings = [{"asset_id": "a1", "location": {"port": 443}}]  # no source_engine
    assert build_corroboration(findings) == {}


def test_confidence_bumps_only_when_corroborated():
    assert corroborated_confidence("tentative", True) == "firm"
    assert corroborated_confidence("firm", True) == "confirmed"
    assert corroborated_confidence("confirmed", True) == "confirmed"
    assert corroborated_confidence("tentative", False) == "tentative"


def test_none_confidence_defaults_tentative():
    assert corroborated_confidence(None, False) == "tentative"


def test_confidence_rank_monotonic():
    assert confidence_rank("tentative") < confidence_rank("firm") < confidence_rank("confirmed")
    assert confidence_rank(None) == 0


def test_int_and_str_port_correlate():
    from scoring.vs_correlation import is_corroborated
    findings = [
        {"asset_id": "a1", "location": {"port": 443}, "source_engine": "nmap"},     # int
        {"asset_id": "a1", "location": {"port": "443"}, "source_engine": "nuclei"}, # str
    ]
    corr = build_corroboration(findings)
    assert is_corroborated(corr, findings[0]) is True   # normalized key => same bucket
    assert is_corroborated(corr, findings[1]) is True


def test_single_engine_not_corroborated():
    from scoring.vs_correlation import is_corroborated
    findings = [{"asset_id": "a1", "location": {"port": 80}, "source_engine": "nuclei"}]
    assert is_corroborated(build_corroboration(findings), findings[0]) is False

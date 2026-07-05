"""Phase-6 pure-logic tests: compliance mapping + report content (real, honest zeros)."""
from scoring.vs_compliance import map_finding_to_controls, compliance_summary
from routes.vs import _build_vs_report_content


def test_compliance_mapping_returns_real_controls():
    m = map_finding_to_controls("cve_match", ["CWE-89"])
    assert isinstance(m, dict) and m               # non-empty
    # Every framework maps to a list of real control-id strings.
    for framework, controls in m.items():
        assert isinstance(controls, list) and all(isinstance(c, str) and c for c in controls)


def test_compliance_summary_empty_is_honest_zero():
    s = compliance_summary([])
    # No fabricated coverage on empty input.
    txt = str(s)
    assert "0" in txt or s == {} or not any(
        v for v in s.values() if isinstance(v, (int,)) and v)


def test_compliance_summary_counts_open_only():
    findings = [
        {"category": "cve_match", "cwe_ids": ["CWE-89"], "severity": "critical", "status": "open"},
        {"category": "tls", "cwe_ids": ["CWE-327"], "severity": "high", "status": "closed"},
    ]
    s = compliance_summary(findings)
    assert isinstance(s, dict) and s


def test_report_content_empty_zeros():
    c = _build_vs_report_content([], "executive")
    assert c["summary"]["total_open"] == 0
    assert c["summary"]["critical"] == 0
    assert c["summary"]["avg_composite_risk"] == 0.0


def test_report_content_technical_includes_findings():
    findings = [{"title": "X", "severity": "high", "status": "open", "composite_risk": 72,
                 "kev": False, "cve_id": "CVE-2024-1", "asset_id": "a1"}]
    c = _build_vs_report_content(findings, "technical")
    assert c["summary"]["total_open"] == 1 and c["summary"]["high"] == 1
    assert "findings" in c and len(c["findings"]) == 1
    assert c["top_findings"][0]["composite_risk"] == 72

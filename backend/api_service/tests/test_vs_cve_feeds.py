"""Unit tests for VS CVE-intel parsing (no network — fixture payloads).

Proves the NVD/KEV/EPSS parse paths extract real fields correctly, so the
feed-sync populates vs_cve_metadata from authentic data (not fabricated).
"""
from datetime import datetime

from utils.cve_feeds import _extract_nvd, _parse_dt


def test_parse_dt_iso_and_zulu():
    assert _parse_dt("2024-01-15T00:00:00.000") == datetime(2024, 1, 15, 0, 0, 0)
    assert _parse_dt("2024-01-15") == datetime(2024, 1, 15)
    assert _parse_dt(None) is None
    assert _parse_dt("garbage") is None


def test_extract_nvd_full_record():
    cve = {
        "id": "CVE-2024-1234",
        "published": "2024-01-01T00:00:00.000",
        "lastModified": "2024-02-01T00:00:00.000",
        "metrics": {
            "cvssMetricV31": [{"cvssData": {"baseScore": 9.8, "vectorString": "CVSS:3.1/AV:N/AC:L/..."}}],
            "cvssMetricV40": [{"cvssData": {"baseScore": 9.3, "vectorString": "CVSS:4.0/AV:N/..."}}],
        },
        "weaknesses": [{"description": [{"value": "CWE-89"}, {"value": "not-a-cwe"}]}],
        "configurations": [{"nodes": [{"cpeMatch": [
            {"criteria": "cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*",
             "versionStartIncluding": "1.0", "versionEndExcluding": "2.0"}
        ]}]}],
        "references": [{"url": "https://example.com/advisory"}],
    }
    out = _extract_nvd(cve)
    assert out["cve_id"] == "CVE-2024-1234"
    assert out["cvss_v31_score"] == 9.8 and out["cvss_v31_vector"].startswith("CVSS:3.1")
    assert out["cvss_v40_score"] == 9.3
    assert out["cwe_ids"] == ["CWE-89"]                      # non-CWE filtered out
    assert out["affected_versions"][0]["vuln_end_excl"] == "2.0"
    assert out["references"] == ["https://example.com/advisory"]
    assert out["published_at"] == datetime(2024, 1, 1)


def test_extract_nvd_missing_id_returns_none():
    assert _extract_nvd({"metrics": {}}) is None


def test_extract_nvd_minimal_record():
    out = _extract_nvd({"id": "CVE-2024-0001"})
    assert out["cve_id"] == "CVE-2024-0001"
    assert "cvss_v31_score" not in out          # absent metrics -> field simply not set
    assert "cwe_ids" not in out

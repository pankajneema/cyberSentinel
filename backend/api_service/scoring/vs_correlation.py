"""Cross-engine correlation — pure, DB-free (Domain 7: false-positive reduction).

A vulnerability location (asset + port) that is independently touched by two or
more distinct scan engines in the same run is *corroborated*: the multi-signal
agreement raises our confidence in the finding, which in turn feeds the composite
risk's confidence_factor. Kept free of any ORM/DB imports so it is unit-testable
in isolation and reusable by the ingest path.
"""
from __future__ import annotations

_CONF_BUMP = {"tentative": "firm", "firm": "confirmed", "confirmed": "confirmed"}
_CONF_RANK = {"tentative": 0, "firm": 1, "confirmed": 2}


def corroboration_key(finding: dict) -> tuple:
    """Location key (asset_id, port) for correlation. Port is normalized to a
    string so engines that emit int (nmap) and str (nuclei) for the same port
    correlate instead of splitting the key. MUST be used by both the map builder
    and the per-finding lookup so their keys are identical."""
    port = (finding.get("location") or {}).get("port")
    port = str(port) if port not in (None, "") else None
    return (finding.get("asset_id"), port)


def build_corroboration(findings: list[dict]) -> dict[tuple, set]:
    """Map (asset_id, port) -> set of distinct source engines that produced a
    finding there this run. A location touched by >=2 engines is 'corroborated'."""
    m: dict[tuple, set] = {}
    for f in findings:
        eng = f.get("source_engine")
        if eng:
            m.setdefault(corroboration_key(f), set()).add(eng)
    return m


def is_corroborated(corr: dict[tuple, set], finding: dict) -> bool:
    """True when the finding's location was seen by >=2 distinct engines."""
    return len(corr.get(corroboration_key(finding), set())) >= 2


def corroborated_confidence(base: str | None, corroborated: bool) -> str:
    """Bump confidence one level when the finding's location is corroborated by
    another engine; otherwise return the base confidence unchanged."""
    base = base or "tentative"
    return _CONF_BUMP.get(base, base) if corroborated else base


def confidence_rank(conf: str | None) -> int:
    """Ordinal rank of a confidence level (tentative<firm<confirmed) so callers
    can enforce 'confidence only ever rises, never falls'."""
    return _CONF_RANK.get(conf or "tentative", 0)

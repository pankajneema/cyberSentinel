# Exposure Scoring (defensible risk model)

Replaces the legacy magic-number heuristic (`len(ports)*3 + 12/sensitive-port` in
`workers/executor/runner/ip.go`) with a transparent, standards-aligned model.

## Where it lives
`backend/api_service/scoring/exposure.py` — pure Python, no DB/heavy deps, fully
unit-tested (`tests/test_exposure_scoring.py`, 7 tests, all passing).

## The model (0–100, explainable)
Score is built from named factors so the UI can show *why*:
- **Open ports / sensitive services** — DBs, RDP/SMB/VNC, Docker API, Redis,
  Mongo, Elastic, etc. carry weighted points (`SENSITIVE_PORTS`).
- **Vulnerabilities** — uses **CVSS** (severity) + **EPSS** (exploit probability) +
  **KEV** (CISA Known-Exploited = hard escalator). Same prioritisation logic as
  Tenable/Qualys/Rapid7.
- **TLS posture** — no-TLS on a sensitive service, expired/self-signed/weak cipher.
- **Sensitive exposed endpoints** — admin panels, backup files, exposed APIs.
- **Context multipliers** — internet-facing vs internal, and asset criticality
  (low/normal/high/critical) scale the result rather than adding flat points.

All weights are in `DEFAULT_WEIGHTS` and can be overridden per-tenant.

## Usage
```python
from scoring import score_exposure, AssetSignals, CveSignal

result = score_exposure(AssetSignals(
    open_ports=[443, 27017],
    is_public=True,
    tls_issues=["expired"],
    cves=[CveSignal("CVE-2024-1234", cvss=9.8, epss=0.92, kev=True)],
    asset_criticality="critical",
))
result.score      # 0–100
result.severity   # critical | high | medium | low | info
result.to_dict()  # {score, severity, factors:[{name, points, detail}, ...]}
```

## Integration points (next wiring step)
1. **Ingestion (reporting service):** when persisting an IP/asset's
   ports/services/ssl/findings, build `AssetSignals` and store the resulting
   `score` + `severity` + factor JSON on the asset/IP row. This replaces the
   number the Go worker currently writes.
2. **API (`routes/asm.py`):** the dashboard/overview can recompute or read the
   stored score, and the asset detail returns `factors` for the "why" panel.
3. **CVE inputs:** map nuclei/nuclei-template findings → `CveSignal`
   (cve_id, cvss from the template, epss/kev from an enrichment feed).

The Go worker's `scoreExposure` (`ip.go`) should be retired in favour of this
single source of truth so scoring is consistent and auditable.

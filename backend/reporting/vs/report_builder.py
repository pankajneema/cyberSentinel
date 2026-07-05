"""
VS (vulnerability scanning) report content builder.

Mirrors backend/api_service/routes/reports.py's ASM content builder: it derives
every number from REAL, already-loaded finding dicts (and optional scan-run
dicts) and never fabricates data. Empty input yields honest zeros — no invented
findings, no invented compliance numbers.

This module is deliberately PURE: no DB, no network, no I/O. The caller loads
the VsFinding rows (as plain dicts) and passes them in, so the whole thing is
unit-testable. All scanner-/user-controlled strings are HTML-escaped on the way
out, matching the escaping approach used by the ASM report builder.

Finding dict shape (see backend/reporting/vs/ingest.py — VsFinding fields):
    {
      "id", "asset_id", "title", "description", "category", "location",
      "evidence", "confidence", "severity", "cve_id", "cvss_base", "epss",
      "kev", "composite_risk", "status", "sla_due_at", "first_detected_at",
      "last_detected_at", ...
    }
"""
from __future__ import annotations

import html
import os
from datetime import datetime

PRODUCT_NAME_FOR_REPORTS = os.getenv("PRODUCT_NAME", "CyberSentinel")

# Active (unresolved) finding states — an SLA can only be breached while open.
_ACTIVE_STATES = {"open", "confirmed", "in_progress"}
_SEVERITIES = ("critical", "high", "medium", "low", "info")


# ---------------------------------------------------------------------------
# escaping — identical approach to reports.py (_content_to_html / _content_to_pdf):
# every scanner-/user-controlled string is routed through html.escape.
# ---------------------------------------------------------------------------
def _h(v) -> str:
    return html.escape("" if v is None else str(v))


def _num(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _is_kev(f: dict) -> bool:
    return bool(f.get("kev"))


def _risk(f: dict) -> float:
    return _num(f.get("composite_risk"), 0.0)


def _sla_breached(f: dict, now: datetime) -> bool:
    """A finding breaches SLA when it is still active and its due date has passed."""
    if (f.get("status") or "open") not in _ACTIVE_STATES:
        return False
    due = f.get("sla_due_at")
    if not due:
        return False
    if isinstance(due, datetime):
        due_dt = due
    else:
        try:
            due_dt = datetime.fromisoformat(str(due).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return False
        if due_dt.tzinfo is not None:
            due_dt = due_dt.replace(tzinfo=None)
    return due_dt < now


# ---------------------------------------------------------------------------
# real aggregates — everything below is computed from the passed-in findings.
# ---------------------------------------------------------------------------
def _severity_counts(findings: list[dict]) -> dict[str, int]:
    counts = {s: 0 for s in _SEVERITIES}
    for f in findings:
        sev = (f.get("severity") or "info").lower()
        counts[sev] = counts.get(sev, 0) + 1
    return counts


def _status_counts(findings: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in findings:
        st = (f.get("status") or "open").lower()
        counts[st] = counts.get(st, 0) + 1
    return counts


def _avg_composite_risk(findings: list[dict]) -> float:
    if not findings:
        return 0.0
    return round(sum(_risk(f) for f in findings) / len(findings), 1)


def _top_by_risk(findings: list[dict], limit: int = 10) -> list[dict]:
    """Top findings by composite_risk — summary fields only, NO raw evidence."""
    ranked = sorted(findings, key=_risk, reverse=True)[:limit]
    return [
        {
            "title": _h(f.get("title")),
            "severity": _h(f.get("severity")),
            "cve": _h(f.get("cve_id")),
            "asset_id": _h(f.get("asset_id")),
            "composite_risk": _risk(f),
        }
        for f in ranked
    ]


def _remediation_summary(findings: list[dict], now: datetime) -> dict:
    """Honest remediation posture — counts only, all grounded in real states."""
    status_counts = _status_counts(findings)
    resolved = sum(
        n for st, n in status_counts.items() if st not in _ACTIVE_STATES
    )
    active = len(findings) - resolved
    breaches = sum(1 for f in findings if _sla_breached(f, now))
    return {
        "total": len(findings),
        "active": active,
        "resolved": resolved,
        "sla_breaches": breaches,
        "by_status": status_counts,
    }


def _finding_row(f: dict, *, include_evidence: bool) -> dict:
    """Full per-finding technical row. Includes evidence only when asked."""
    row = {
        "title": _h(f.get("title")),
        "severity": _h(f.get("severity")),
        "cve": _h(f.get("cve_id")),
        "cvss": f.get("cvss_base"),
        "epss": f.get("epss"),
        "kev": _is_kev(f),
        "composite_risk": _risk(f),
        "asset_id": _h(f.get("asset_id")),
        "location": _h(f.get("location")),
        "status": _h(f.get("status")),
    }
    if include_evidence:
        row["evidence"] = _h(f.get("evidence"))
        row["description"] = _h(f.get("description"))
    return row


def _remediation_guidance(f: dict) -> dict:
    """Audience-friendly, per-finding guidance — no raw host/evidence dumps."""
    sev = (f.get("severity") or "info").lower()
    cve = f.get("cve_id")
    if cve:
        action = f"Apply the vendor fix / patch for {cve} on the affected asset."
    else:
        action = "Apply the recommended configuration change or vendor update for this issue."
    if _is_kev(f):
        action = "Actively exploited (CISA KEV) — remediate on an emergency basis. " + action
    return {
        "title": _h(f.get("title")),
        "severity": _h(sev),
        "cve": _h(cve),
        "guidance": _h(action),
    }


def _scan_run_summary(scan_runs: list[dict] | None) -> dict:
    """Roll up real scan-run metadata; zeros when no runs were passed."""
    runs = scan_runs or []
    completed = sum(1 for r in runs if (r.get("status") or "").upper() == "COMPLETED")
    failed = sum(1 for r in runs if (r.get("status") or "").upper() == "FAILED")
    last_completed_at = None
    for r in runs:
        ts = r.get("completed_at")
        if ts and (last_completed_at is None or str(ts) > str(last_completed_at)):
            last_completed_at = ts
    return {
        "total_runs": len(runs),
        "completed_runs": completed,
        "failed_runs": failed,
        "last_completed_at": _h(last_completed_at) if last_completed_at else None,
    }


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------
def build_vs_report_content(
    findings: list[dict],
    scan_runs: list[dict] | None,
    report_type: str,
) -> dict:
    """Build the CONTENT dict for a VS report from REAL findings.

    report_type in {executive, technical, customer, compliance}. Unknown types
    fall back to executive. Nothing is fabricated — sections are omitted, never
    invented, and empty input yields honest zeros.
    """
    findings = findings or []
    report_type = (report_type or "executive").lower()
    now = datetime.utcnow()

    severity_counts = _severity_counts(findings)
    kev_count = sum(1 for f in findings if _is_kev(f))
    avg_risk = _avg_composite_risk(findings)
    remediation = _remediation_summary(findings, now)
    runs_summary = _scan_run_summary(scan_runs)

    meta = {
        "module": "vs",
        "report_type": report_type,
        "generated_at": now.isoformat() + "Z",
        "finding_count": len(findings),
    }

    summary = {
        "total_findings": len(findings),
        "by_severity": severity_counts,
        "kev_count": kev_count,
        "avg_composite_risk": avg_risk,
        "sla_breaches": remediation["sla_breaches"],
        "scan_runs": runs_summary,
    }

    # ------------------------------------------------------------------
    # technical: full per-finding table + evidence (raw detail).
    # ------------------------------------------------------------------
    if report_type == "technical":
        return {
            "meta": meta,
            "sections_included": [
                "summary", "scan_runs", "findings", "remediation",
            ],
            "summary": summary,
            "scan_runs": runs_summary,
            "findings": [_finding_row(f, include_evidence=True) for f in findings],
            "remediation": remediation,
        }

    # ------------------------------------------------------------------
    # customer: findings + remediation guidance only, branded-ish.
    # ------------------------------------------------------------------
    if report_type == "customer":
        return {
            "meta": meta,
            "sections_included": ["overview", "findings", "remediation_guidance"],
            "branding": {
                "product": PRODUCT_NAME_FOR_REPORTS,
                "prepared_for": "Customer",
                "tagline": f"Vulnerability posture summary prepared by {PRODUCT_NAME_FOR_REPORTS}",
            },
            "overview": {
                "total_findings": len(findings),
                "by_severity": severity_counts,
                "kev_count": kev_count,
            },
            "findings": [_finding_row(f, include_evidence=False) for f in findings],
            "remediation_guidance": [_remediation_guidance(f) for f in findings],
        }

    # ------------------------------------------------------------------
    # compliance: per-framework control rollup from the sibling scoring
    # module. Imported lazily so this file compiles before that module
    # exists (created by a sibling task).
    # ------------------------------------------------------------------
    if report_type == "compliance":
        try:
            from backend.api_service.scoring.vs_compliance import compliance_summary
            frameworks = compliance_summary(findings)
        except Exception:  # noqa: BLE001 — module not present yet / import failure
            frameworks = None

        sections = ["summary", "remediation"]
        content = {
            "meta": meta,
            "summary": summary,
            "remediation": remediation,
        }
        if frameworks is not None:
            content["compliance"] = frameworks
            sections.insert(1, "compliance")
        content["sections_included"] = sections
        return content

    # ------------------------------------------------------------------
    # executive (default): high-level rollup, NO raw host/evidence dumps.
    # ------------------------------------------------------------------
    return {
        "meta": meta,
        "sections_included": [
            "summary", "top_findings", "remediation",
        ],
        "summary": summary,
        "top_findings": _top_by_risk(findings, limit=10),
        "remediation": remediation,
    }

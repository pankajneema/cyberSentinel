"""
report.vs ingestion — persists normalized VS findings published by the Go
worker, enriches them from the CVE intel cache, computes the composite risk
score, runs the lifecycle/delta (new / reappeared / fixed), and updates run +
scan state. Idempotent: keyed on (org_id, dedup_key), safe to replay.

Contract (report.vs message):
  { scan_run_id, scan_id, org_id, status: "completed"|"failed", error,
    engine_versions, targets: [{asset_id, host, status}],
    findings: [{asset_id, source_engine, plugin_id, cve_ids[], title, description,
                category, location, evidence, confidence, severity, cvss_base}] }
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select

from backend.api_service.models.vs_models import (
    VsScan, VsScanRun, VsScanTarget, VsFinding, VsFindingHistory, VsCveMetadata,
)
from backend.api_service.models.asset_models import Asset
from backend.api_service.scoring.vs_risk import compute_vs_risk
from backend.api_service.scoring.vs_correlation import (
    build_corroboration, corroborated_confidence, confidence_rank, is_corroborated,
)
from backend.reporting.sanitize import clean_str, clean_deep

logger = logging.getLogger("cybersentinel.reporting.vs")

_SLA_DAYS = {"critical": 7, "high": 15, "medium": 30, "low": 90, "info": 0}
_RESOLVED_STATES = {"remediated", "verified", "closed", "accepted_risk", "false_positive"}
_ACTIVE_STATES = {"open", "confirmed", "in_progress"}


def compute_dedup_key(asset_id: str, plugin_id: str | None, cve_ids: list[str] | None,
                      location: dict | None) -> str:
    """Stable identity for a finding across scans (Domain 5 dedup)."""
    loc = json.dumps(location or {}, sort_keys=True)
    cves = ",".join(sorted(cve_ids or []))
    raw = f"{asset_id}|{plugin_id or ''}|{cves}|{loc}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _cve_meta(db, cve_ids: list[str]) -> dict[str, VsCveMetadata]:
    if not cve_ids:
        return {}
    rows = (await db.execute(select(VsCveMetadata).where(
        VsCveMetadata.cve_id.in_(cve_ids)))).scalars().all()
    return {r.cve_id: r for r in rows}


async def ingest_vs_result(db, payload: dict) -> dict:
    """Persist one report.vs message. Returns a stats dict."""
    run_id = payload.get("scan_run_id")
    org_id = payload.get("org_id")
    if not run_id or not org_id:
        return {"error": "missing scan_run_id/org_id"}

    run = (await db.execute(select(VsScanRun).where(
        VsScanRun.id == run_id, VsScanRun.org_id == org_id))).scalar_one_or_none()
    if run is None:
        logger.warning("report.vs for unknown run %s", run_id)
        return {"error": "unknown run"}
    scan = (await db.execute(select(VsScan).where(VsScan.id == run.scan_id))).scalar_one_or_none()
    now = datetime.utcnow()

    # Worker-reported failure: mark terminal, don't fabricate findings.
    if payload.get("status") == "failed":
        run.status = "FAILED"
        run.error_message = clean_str(payload.get("error")) or "scan failed"
        run.completed_at = now
        if scan:
            scan.status = "FAILED"
        await db.commit()
        return {"status": "failed"}

    findings = payload.get("findings") or []

    # Pre-load CVE intel + the assets touched this run (batched, no N+1).
    all_cves = sorted({c for f in findings for c in (f.get("cve_ids") or [])})
    cve_map = await _cve_meta(db, all_cves)
    asset_ids = sorted({f.get("asset_id") for f in findings if f.get("asset_id")}
                       | {t.get("asset_id") for t in payload.get("targets") or []})
    assets = {}
    if asset_ids:
        for a in (await db.execute(select(Asset).where(Asset.id.in_(asset_ids)))).scalars().all():
            assets[a.id] = a

    # Build (dedup_key -> normalized finding) and batch-load existing rows.
    prepared: list[dict] = []
    for f in findings:
        cve_ids = [c for c in (f.get("cve_ids") or []) if c]
        key = compute_dedup_key(f.get("asset_id"), f.get("plugin_id"), cve_ids, f.get("location"))
        prepared.append({"raw": f, "cves": cve_ids, "key": key})
    keys = [p["key"] for p in prepared]
    existing = {}
    if keys:
        for row in (await db.execute(select(VsFinding).where(
                VsFinding.org_id == org_id, VsFinding.dedup_key.in_(keys)))).scalars().all():
            existing[row.dedup_key] = row

    new_count = reappeared = 0
    seen_keys: set[str] = set()
    new_criticals = 0
    new_critical_rows: list[dict] = []
    # Cross-engine correlation (Domain 7): a location seen by >=2 engines this
    # run corroborates the finding and raises its confidence.
    corr = build_corroboration(findings)

    for p in prepared:
        f, cve_ids, key = p["raw"], p["cves"], p["key"]
        seen_keys.add(key)
        primary_cve = cve_ids[0] if cve_ids else None
        meta = cve_map.get(primary_cve) if primary_cve else None

        cvss = (meta.cvss_v31_score if meta and meta.cvss_v31_score is not None
                else f.get("cvss_base"))
        epss = meta.epss_score if meta else None
        kev = bool(meta.kev) if meta else False

        asset = assets.get(f.get("asset_id"))
        exposure = (asset.exposure if asset and asset.exposure else "internal")
        criticality = (asset.criticality if asset and asset.criticality else "normal")
        eff_conf = corroborated_confidence(f.get("confidence") or "tentative",
                                           is_corroborated(corr, f))
        risk = compute_vs_risk(
            cvss_base=cvss, epss=epss, kev=kev,
            exposure=exposure, criticality=criticality,
            confidence=eff_conf,
            raw_severity=f.get("severity"),
        )
        sla_days = _SLA_DAYS.get(risk.severity, 0)
        sla_due = now + timedelta(days=sla_days) if sla_days else None

        row = existing.get(key)
        if row is None:
            row = VsFinding(
                org_id=org_id, asset_id=f.get("asset_id"), scan_run_id=run.id,
                first_seen_run_id=run.id, dedup_key=key,
                source_engine=f.get("source_engine") or "unknown",
                plugin_id=f.get("plugin_id"), cve_id=primary_cve,
                title=clean_str(f.get("title")) or "Untitled finding",
                description=clean_str(f.get("description")),
                category=f.get("category"),
                location=clean_deep(f.get("location")) if f.get("location") else None,
                evidence=clean_str(f.get("evidence")),
                confidence=eff_conf,
                severity=risk.severity, cvss_base=cvss, epss=epss, kev=kev,
                composite_risk=risk.score, risk_factors=risk.to_dict()["factors"],
                status="open", sla_due_at=sla_due,
                first_detected_at=now, last_detected_at=now,
            )
            db.add(row)
            new_count += 1
            if risk.severity == "critical":
                new_criticals += 1
                new_critical_rows.append({
                    "title": row.title, "severity": "critical", "cve_id": primary_cve,
                    "cvss_base": cvss, "epss": epss, "kev": kev,
                    "composite_risk": risk.score, "plugin_id": row.plugin_id,
                    "asset_id": row.asset_id, "evidence": row.evidence,
                    "description": row.description,
                })
        else:
            # Refresh mutable intel + risk; reopen if it had been resolved (reappeared).
            row.scan_run_id = run.id
            row.last_detected_at = now
            row.cve_id = primary_cve
            row.cvss_base, row.epss, row.kev = cvss, epss, kev
            row.composite_risk = risk.score
            row.severity = risk.severity
            row.risk_factors = risk.to_dict()["factors"]
            row.evidence = clean_str(f.get("evidence"))
            row.sla_due_at = sla_due
            # Confidence only ever rises (corroboration/verification), never falls.
            if confidence_rank(eff_conf) > confidence_rank(row.confidence):
                row.confidence = eff_conf
            # ONE transition per re-detection (no double history):
            #  - rescan re-detection => confirmed (verification confirms it);
            #  - normal re-detection of a resolved finding => reopened (reappeared).
            was_resolved = row.status in _RESOLVED_STATES
            if run.triggered_by == "rescan":
                row.confidence = "confirmed"
                if row.status != "confirmed":
                    db.add(VsFindingHistory(
                        finding_id=row.id, org_id=org_id, from_status=row.status,
                        to_status="confirmed", actor_user_id=None,
                        justification="Confirmed by verification re-scan"))
                    row.status = "confirmed"
                    row.resolved_at = None
                    if was_resolved:
                        reappeared += 1
            elif was_resolved:
                db.add(VsFindingHistory(
                    finding_id=row.id, org_id=org_id, from_status=row.status,
                    to_status="open", actor_user_id=None,
                    justification="Reappeared in a later scan"))
                row.status = "open"
                row.resolved_at = None
                reappeared += 1

    # Fixed delta: active findings on scanned assets not re-detected this run.
    fixed = 0
    scanned_asset_ids = [t.get("asset_id") for t in (payload.get("targets") or [])
                         if t.get("status") == "scanned" and t.get("asset_id")]
    if scanned_asset_ids:
        stale = (await db.execute(select(VsFinding).where(
            VsFinding.org_id == org_id,
            VsFinding.asset_id.in_(scanned_asset_ids),
            VsFinding.status.in_(_ACTIVE_STATES),
        ))).scalars().all()
        for row in stale:
            if row.dedup_key in seen_keys:
                continue
            db.add(VsFindingHistory(finding_id=row.id, org_id=org_id,
                                    from_status=row.status, to_status="remediated",
                                    actor_user_id=None,
                                    justification="Not detected in the latest scan"))
            row.status = "remediated"
            row.resolved_at = now
            fixed += 1

    # Mark scan targets scanned; finalize run + scan.
    payload_target_status = {t.get("asset_id"): (t.get("status") or "scanned")
                             for t in (payload.get("targets") or []) if t.get("asset_id")}
    for t in (await db.execute(select(VsScanTarget).where(
            VsScanTarget.scan_run_id == run.id))).scalars().all():
        t.status = payload_target_status.get(t.asset_id, "scanned")
    run.status = "COMPLETED"
    run.completed_at = now
    run.engine_versions = payload.get("engine_versions")
    run.stats = {"targets": len(payload.get("targets") or []), "findings": len(findings),
                 "new": new_count, "reappeared": reappeared, "fixed": fixed}
    if scan:
        scan.status = "COMPLETED"
        scan.last_run_at = now
    await db.commit()

    stats = {"new": new_count, "reappeared": reappeared, "fixed": fixed,
             "total": len(findings), "new_criticals": new_criticals}
    logger.info("report.vs ingested run=%s %s", run_id, stats)
    await _notify(org_id, scan, run, stats, new_critical_rows)
    return stats


async def _dispatch_integrations(scan, critical_findings: list[dict]) -> None:
    """Create Jira tickets / forward to SIEM for new criticals, if the scan
    owner has configured integrations (AsmSettings.settings['integrations'])."""
    if not scan or not critical_findings:
        return
    try:
        from sqlalchemy import select as _select
        from backend.api_service.models.asm_models import AsmSettings
        from backend.api_service.utils.database import AsyncSessionLocal
        from backend.notificationservice.integrations import notify_integrations
        async with AsyncSessionLocal() as db:
            row = (await db.execute(_select(AsmSettings).where(
                AsmSettings.user_id == scan.user_id))).scalar_one_or_none()
        cfg = (row.settings or {}).get("integrations") if row and isinstance(row.settings, dict) else None
        if not cfg:
            return   # honest no-op — no integrations configured
        for f in critical_findings:
            await notify_integrations(f, cfg)
    except Exception as e:  # noqa: BLE001
        logger.warning("VS integrations dispatch failed: %s", e)


async def _notify(org_id, scan, run, stats, critical_findings: list[dict] | None = None) -> None:
    """Best-effort scan-complete + new-critical notifications + integrations."""
    try:
        from backend.notificationservice import dispatcher, events as ev
        from backend.api_service.utils.database import AsyncSessionLocal
        name = (scan.name if scan else run.scan_id)
        async with AsyncSessionLocal() as ndb:
            await dispatcher.dispatch(
                ndb, org_id, ev.SCAN_COMPLETED,
                title=f"Vulnerability scan completed: {name}",
                body=f"{stats['new']} new, {stats['reappeared']} reappeared, {stats['fixed']} fixed.",
                severity="info", link="/app/vs",
                meta={"scan_run_id": run.id, "module": "vs"},
                owner_user_id=(scan.user_id if scan else None),
            )
            if stats["new_criticals"]:
                await dispatcher.dispatch(
                    ndb, org_id, ev.FINDING_CRITICAL,
                    title=f"{stats['new_criticals']} new critical vulnerability(ies): {name}",
                    body="Review and remediate the newly discovered critical findings.",
                    severity="high", link="/app/vs",
                    meta={"scan_run_id": run.id, "module": "vs"},
                    owner_user_id=(scan.user_id if scan else None),
                )
    except Exception as e:  # noqa: BLE001
        logger.warning("VS notify failed: %s", e)

    await _dispatch_integrations(scan, critical_findings or [])

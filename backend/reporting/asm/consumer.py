"""ASM reporting consumer — persists stage findings and finalizes the run.

Consumes ``reporting.asm`` (published by the Go worker). Message kinds:
  * stage_findings — upsert subdomain/ip/http/port/service/tls/endpoint
    (admin + backup_file)/cloud/saas/repo_secret/email_leak findings into
    their tables, and update existing AsmIP rows with ip_enrichment
    (geo/ASN) data. Finding type->target/data shapes come straight from
    the Go tool adapters (worker/tools/adapt_*.go) — check there before
    adding a new type.
  * task_terminal  — set asm_discoveries.status + last_run_at, stamp
    Asset.last_seen for every targeted asset, notify, refresh CA.

For ASM the job's task_id IS the asm_discoveries.id, so finding rows use
asm_discovery_id = task_id.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.api_service.models.asm_models import (
    AsmAdminEndpoint,
    AsmAPIEndpoint,
    AsmBackupFile,
    AsmCloudResource,
    AsmDiscovery,
    AsmDiscoveryRun,
    AsmIP,
    AsmPort,
    AsmRepoFinding,
    AsmSaasApp,
    AsmService,
    AsmSSLCert,
    AsmSubdomain,
    AsmUserAccount,
)
from backend.api_service.models.asset_models import Asset
from backend.reporting.asm.assets.domain import _parse_cert_datetime
from backend.api_service.utils.scan_contracts import (
    SERVICE_ASM,
    STATE_CANCELLED,
    STATE_COMPLETED,
    STATE_FAILED,
    reporting_queue,
)
from backend.api_service.utils.reporting import (
    AsyncSessionLocal,
    consume_messages,
    logger,
    notify_scan,
)

# Worker task states -> the asm_status enum (CANCELLED maps to FAILED for the rollup).
_STATUS = {STATE_COMPLETED: "COMPLETED", STATE_FAILED: "FAILED", STATE_CANCELLED: "FAILED"}


async def _upsert(db, model, values: dict, constraint: str) -> None:
    stmt = pg_insert(model.__table__).values(**values).on_conflict_do_nothing(constraint=constraint)
    await db.execute(stmt)


async def _persist_stage(payload: dict[str, Any]) -> None:
    discovery_id = payload.get("task_id")
    if not discovery_id:
        return
    asset_id = payload.get("asset_id") or ""
    org_id = payload.get("org_id")
    findings = payload.get("findings") or []
    if not findings:
        return
    async with AsyncSessionLocal() as db:
        for f in findings:
            ftype = f.get("type")
            target = (f.get("target") or "").strip()
            data = f.get("data") or {}
            if not target:
                continue
            try:
                if ftype == "subdomain":
                    await _upsert(db, AsmSubdomain, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "subdomain": target,
                    }, "uq_subdomain_per_asset")
                elif ftype == "resolution":
                    await _upsert(db, AsmSubdomain, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "subdomain": target, "resolved": True,
                    }, "uq_subdomain_per_asset")
                    for ip in (data.get("ips") or []):
                        if ip:
                            await _upsert(db, AsmIP, {
                                "asm_discovery_id": discovery_id, "org_id": org_id,
                                "asset_id": asset_id, "ip_address": ip, "subdomain": target,
                            }, "uq_ip_per_asset_subdomain")
                elif ftype == "ip":
                    await _upsert(db, AsmIP, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "ip_address": target,
                        "subdomain": data.get("subdomain"),
                    }, "uq_ip_per_asset_subdomain")
                elif ftype == "ip_enrichment":
                    # target = IP (worker/tools/adapt_ip_enrich.go, ip_enrichment_cached/
                    # _fresh). Enriches the AsmIP row(s) this discovery already created
                    # for that address (via the "ip"/"resolution" findings, which run
                    # earlier in every pipeline) — an UPDATE, not an insert, since a
                    # single IP can have multiple rows (one per resolving subdomain) and
                    # all of them should carry the same geo/ASN data. Powers the ASM Geo
                    # Map (GET /asm/ips/geo-map), which was silently empty without this.
                    await db.execute(
                        update(AsmIP).where(
                            AsmIP.asm_discovery_id == discovery_id,
                            AsmIP.ip_address == target,
                        ).values(
                            country=data.get("country"),
                            country_code=data.get("country_code"),
                            region=data.get("region"),
                            city=data.get("city"),
                            latitude=data.get("latitude"),
                            longitude=data.get("longitude"),
                            asn=data.get("asn"),
                            asn_org=data.get("asn_org"),
                            isp=data.get("isp"),
                        )
                    )
                elif ftype == "http":
                    await _upsert(db, AsmAPIEndpoint, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "url": target,
                        "status_code": data.get("status_code"),
                        "title": f.get("name") or None,
                    }, "uq_endpoint_per_discovery")
                elif ftype == "port":
                    # target = IP (worker/tools/adapt_naabu.go)
                    await _upsert(db, AsmPort, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "ip_address": target,
                        "port": data.get("port"), "protocol": data.get("protocol") or "tcp",
                    }, "uq_port_per_discovery")
                elif ftype == "service":
                    # target = IP (worker/tools/adapt_nmap.go)
                    await _upsert(db, AsmService, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "ip_address": target,
                        "port": data.get("port"),
                        "service_name": data.get("service") or f.get("name") or "unknown",
                        "version": data.get("version"), "product": data.get("product"),
                        "extra_info": data,
                    }, "uq_service_per_discovery")
                elif ftype == "tls":
                    # target = host (worker/tools/adapt_sslscan.go)
                    await _upsert(db, AsmSSLCert, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "host": target,
                        "port": data.get("port") or 443,
                        "protocol": data.get("protocol"), "cipher": data.get("cipher"),
                        "certificate_issuer": data.get("issuer") or f.get("name"),
                        "valid_until": _parse_cert_datetime(data.get("valid_until")),
                    }, "uq_ssl_per_discovery")
                elif ftype == "endpoint" and f.get("name") == "admin":
                    # worker/tools/adapt_gobuster.go (admin_finder)
                    await _upsert(db, AsmAdminEndpoint, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "url": target,
                        "status_code": data.get("status"), "response_size": data.get("size"),
                        "endpoint_type": "admin",
                    }, "uq_admin_endpoint")
                elif ftype == "endpoint" and f.get("name") == "backup_file":
                    # worker/tools/adapt_domain_enrich.go (backup_detector)
                    await _upsert(db, AsmBackupFile, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "file_url": target,
                        "file_extension": data.get("extension"), "status": data.get("status"),
                    }, "uq_backup_file")
                elif ftype == "cloud":
                    # target = resource name (worker/tools/adapt_cloudenum.go)
                    await _upsert(db, AsmCloudResource, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "resource_name": target,
                        "service": data.get("provider") or "unknown",
                        "resource_type": data.get("type") or f.get("name") or "unknown",
                        "access_status": data.get("exposure"), "extra_info": data,
                    }, "uq_cloud_resource")
                elif ftype == "saas":
                    # target = detected app's URL or name (worker/tools/adapt_saasdetect.go)
                    await _upsert(db, AsmSaasApp, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id,
                        "app_name": data.get("app_name") or f.get("name") or target,
                        "vendor": data.get("vendor"), "category": data.get("category"),
                        "url": data.get("url"), "status": data.get("status"),
                        "discovery_method": data.get("discovery_method"),
                        "extra_info": data,
                    }, "uq_saas_app")
                elif ftype == "repo_secret":
                    # target = "<repo_url>[:<file_path>]" (worker/tools/adapt_reposcan.go).
                    # The Go adapter never sends the "secret" key at all (stripped for
                    # privacy before it leaves the worker), so that column stays NULL.
                    await _upsert(db, AsmRepoFinding, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "repo_url": data.get("repo_url") or target,
                        "finding_type": data.get("finding_type"), "rule": f.get("name"),
                        "severity": f.get("severity"), "file_path": data.get("file_path"),
                        "line": data.get("line"), "commit": data.get("commit"),
                        "extra_info": data,
                    }, "uq_repo_finding")
                elif ftype == "email_leak":
                    # target = email address (worker/tools/adapt_emailleak.go)
                    await _upsert(db, AsmUserAccount, {
                        "asm_discovery_id": discovery_id, "org_id": org_id,
                        "asset_id": asset_id, "email": data.get("email") or target,
                        "source": data.get("source") or f.get("name"),
                        "breached": bool(data.get("breached", True)),
                        "breach_count": data.get("breach_count"),
                        "exposed_data": data.get("exposed_data"),
                        "severity": data.get("severity") or f.get("severity"),
                        "extra_info": data,
                    }, "uq_user_account")
                else:
                    logger.debug("asm finding type %r not persisted (target=%s)", ftype, target)
            except Exception:  # noqa: BLE001 - one bad finding must not sink the batch
                logger.exception("persist asm finding type=%s target=%s", ftype, target)
        await db.commit()


async def _finalize(payload: dict[str, Any]) -> None:
    discovery_id = payload.get("task_id")
    org_id = payload.get("org_id")
    status = payload.get("status") or STATE_COMPLETED

    if discovery_id:
        async with AsyncSessionLocal() as db:
            disc = await db.get(AsmDiscovery, discovery_id)
            if disc is not None:
                disc.status = _STATUS.get(status, disc.status)
                disc.last_run_at = datetime.utcnow()

                # Asset.last_seen had no writer anywhere in the codebase — every
                # asset showed "-" in the inventory table forever, regardless of
                # how many scans ran. A successful discovery is exactly "we just
                # observed this asset is still there", so stamp it here.
                if _STATUS.get(status) == "COMPLETED" and disc.asset_ids:
                    await db.execute(
                        update(Asset).where(Asset.id.in_(disc.asset_ids)).values(last_seen=disc.last_run_at.isoformat() + "Z")
                    )

            # Close out the in-flight run row created when the job was enqueued
            # (asm/service.py's enqueue_discovery) — without this, "Discovery
            # Runs" and the /asm/runs endpoints stayed permanently empty, and a
            # failed run had nowhere to surface *why* it failed.
            run = (await db.execute(
                select(AsmDiscoveryRun)
                .where(AsmDiscoveryRun.asm_discovery_id == discovery_id, AsmDiscoveryRun.status == "RUNNING")
                .order_by(AsmDiscoveryRun.started_at.desc())
                .limit(1)
            )).scalar_one_or_none()
            if run is not None:
                run.status = _STATUS.get(status, "FAILED")
                run.completed_at = datetime.utcnow()
                stages = payload.get("stages") or []
                errors = [s.get("error") for s in stages if isinstance(s, dict) and s.get("error")]
                if errors:
                    run.error_message = "; ".join(errors)
                # Real, not fabricated — intensity comes straight off the
                # discovery config, pipeline_steps off the worker's own stage
                # list. Per-type found/inserted/skipped isn't tracked anywhere
                # yet, so those fields stay absent rather than guessed.
                run.summary = {
                    "intensity": disc.intensity if disc is not None else None,
                    "pipeline_steps": len(stages),
                }

            await db.commit()

    await notify_scan(org_id, service=SERVICE_ASM, task_id=discovery_id, status=status)

    # Continuous-compliance refresh (best-effort; never blocks reporting).
    try:
        from backend.reporting.ca.ca_hook import trigger_ca_evaluation
        await trigger_ca_evaluation(org_id, reason="asm_scan")
    except Exception:  # noqa: BLE001
        logger.debug("CA refresh after ASM skipped", exc_info=True)


async def _handle(payload: dict[str, Any]) -> None:
    try:
        kind = payload.get("kind")
        if kind == "stage_findings":
            await _persist_stage(payload)
        elif kind == "task_terminal":
            await _finalize(payload)
        else:
            logger.info("asm reporting: unhandled kind=%s", kind)
    except Exception:  # noqa: BLE001 - ack (don't poison-DLQ) on a bad message
        logger.exception("asm reporting: failed to handle message")


async def run() -> None:
    q = reporting_queue(SERVICE_ASM)
    logger.info("ASM reporting consumer started -> %s", q)
    await consume_messages(q, _handle)

"""
IP ASM Reporting - Process discovered IP findings from pipeline results.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api_service.models.asm_models import AsmIP
from backend.reporting.asm.assets.common import ensure_discovery_run
from backend.reporting.asm.assets.domain import get_user_id_from_discovery, store_step_data

logger = logging.getLogger(__name__)


def _first_asset_id(payload: dict[str, Any]) -> str:
    for step in payload.get("pipeline", []):
        aid = step.get("asset_id")
        if aid:
            return str(aid)
    return ""


def _extract_ips(payload: dict[str, Any]) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    """Return ip->asset_id map and ip metadata map."""
    ip_asset_map: dict[str, str] = {}
    metadata: dict[str, dict[str, Any]] = {}

    pipeline = payload.get("pipeline", [])
    for step in pipeline:
        if step.get("status") != "COMPLETED":
            continue
        step_name = step.get("step", "")
        result = step.get("result", {}) or {}
        asset_id = step.get("asset_id") or _first_asset_id(payload)

        if step_name == "ip_target_seed":
            for item in result.get("targets", []) if isinstance(result.get("targets"), list) else []:
                if not isinstance(item, dict):
                    continue
                ip = str(item.get("target", "")).strip()
                if not ip:
                    continue
                ip_asset_map[ip] = str(item.get("asset_id") or asset_id or "")
                metadata.setdefault(ip, {}).update(
                    {
                        "attribution_source": item.get("source"),
                        "attribution_confidence": item.get("confidence"),
                    }
                )

        if step_name == "alive_check":
            alive_set = set()
            for ip in result.get("alive", []) if isinstance(result.get("alive"), list) else []:
                ip_s = str(ip).strip()
                if ip_s:
                    alive_set.add(ip_s)
            for ip in alive_set:
                ip_asset_map.setdefault(ip, asset_id or "")
                metadata.setdefault(ip, {})["reachable"] = True
            for ip in result.get("dead", []) if isinstance(result.get("dead"), list) else []:
                ip_s = str(ip).strip()
                if ip_s:
                    ip_asset_map.setdefault(ip_s, asset_id or "")
                    metadata.setdefault(ip_s, {})["reachable"] = False

        if step_name == "asn_geo_mapping":
            for item in result.get("enrichment", []) if isinstance(result.get("enrichment"), list) else []:
                if not isinstance(item, dict):
                    continue
                ip = str(item.get("ip", "")).strip()
                if not ip:
                    continue
                ip_asset_map.setdefault(ip, asset_id or "")
                metadata.setdefault(ip, {}).update(
                    {
                        "country": item.get("country"),
                        "country_code": item.get("country_code"),
                        "region": item.get("region"),
                        "city": item.get("city"),
                        "latitude": item.get("latitude"),
                        "longitude": item.get("longitude"),
                        "asn": item.get("asn"),
                        "asn_org": item.get("asn_org"),
                        "isp": item.get("isp"),
                    }
                )

        if step_name == "whois_rdap":
            for item in result.get("whois_rdap", []) if isinstance(result.get("whois_rdap"), list) else []:
                if not isinstance(item, dict):
                    continue
                ip = str(item.get("ip", "")).strip()
                if not ip:
                    continue
                ip_asset_map.setdefault(ip, asset_id or "")
                metadata.setdefault(ip, {}).update(
                    {
                        "owner_org": item.get("name"),
                        "rdap_country": item.get("country"),
                    }
                )

        if step_name == "exposure_scoring":
            scores = result.get("scores", {})
            if isinstance(scores, dict):
                for ip, score_item in scores.items():
                    if not isinstance(score_item, dict):
                        continue
                    ip_s = str(ip).strip()
                    if not ip_s:
                        continue
                    ip_asset_map.setdefault(ip_s, asset_id or "")
                    metadata.setdefault(ip_s, {}).update(
                        {
                            "exposure_score": score_item.get("score"),
                            "exposure_level": score_item.get("level"),
                            "score_explanation": score_item.get("reasons"),
                        }
                    )

    return ip_asset_map, metadata


async def process_ip_asm(db: AsyncSession, payload: dict[str, Any]) -> None:
    job_id = payload.get("job_id")
    intensity = payload.get("intensity", "LIGHT")
    status = payload.get("status", "COMPLETED")

    user_id = await get_user_id_from_discovery(db, job_id) or "system"
    run = await ensure_discovery_run(db, job_id, user_id)

    ip_asset_map, metadata = _extract_ips(payload)
    inserted = 0
    updated = 0

    toolchain = [step.get("tool") for step in payload.get("pipeline", []) if step.get("tool")]
    duration_ms = sum(int(step.get("execution_time_ms") or 0) for step in payload.get("pipeline", []))

    for ip, asset_id in ip_asset_map.items():
        if not asset_id:
            continue
        ip_meta = metadata.get(ip, {})

        existing = (
            (
                await db.execute(
                    select(AsmIP).where(
                        AsmIP.asm_discovery_id == job_id,
                        AsmIP.asset_id == asset_id,
                        AsmIP.ip_address == ip,
                        AsmIP.subdomain_id.is_(None),
                    )
                )
            )
            .scalars()
            .first()
        )

        if existing:
            existing.status = "active" if ip_meta.get("reachable", True) else "inactive"
            existing.reachable = ip_meta.get("reachable", existing.reachable)
            existing.country = ip_meta.get("country", existing.country)
            existing.country_code = ip_meta.get("country_code", existing.country_code)
            existing.region = ip_meta.get("region", existing.region)
            existing.city = ip_meta.get("city", existing.city)
            existing.latitude = ip_meta.get("latitude", existing.latitude)
            existing.longitude = ip_meta.get("longitude", existing.longitude)
            existing.asn = ip_meta.get("asn", existing.asn)
            existing.asn_org = ip_meta.get("asn_org", existing.asn_org)
            existing.isp = ip_meta.get("isp", existing.isp)
            existing.owner_org = ip_meta.get("owner_org", existing.owner_org)
            existing.rdap_country = ip_meta.get("rdap_country", existing.rdap_country)
            existing.exposure_score = ip_meta.get("exposure_score", existing.exposure_score)
            existing.exposure_level = ip_meta.get("exposure_level", existing.exposure_level)
            existing.attribution_source = ip_meta.get("attribution_source", existing.attribution_source)
            existing.attribution_confidence = ip_meta.get(
                "attribution_confidence", existing.attribution_confidence
            )
            existing.last_scanned_at = datetime.utcnow()
            existing.last_scan_duration_ms = duration_ms
            existing.scan_metadata = {
                "intensity": intensity,
                "toolchain": toolchain,
            }
            existing.score_explanation = ip_meta.get("score_explanation", existing.score_explanation)
            updated += 1
            continue

        db.add(
            AsmIP(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                ip_address=ip,
                subdomain_id=None,
                subdomain=None,
                status="active" if ip_meta.get("reachable", True) else "inactive",
                reachable=ip_meta.get("reachable"),
                country=ip_meta.get("country"),
                country_code=ip_meta.get("country_code"),
                region=ip_meta.get("region"),
                city=ip_meta.get("city"),
                latitude=ip_meta.get("latitude"),
                longitude=ip_meta.get("longitude"),
                asn=ip_meta.get("asn"),
                asn_org=ip_meta.get("asn_org"),
                isp=ip_meta.get("isp"),
                owner_org=ip_meta.get("owner_org"),
                rdap_country=ip_meta.get("rdap_country"),
                exposure_score=ip_meta.get("exposure_score"),
                exposure_level=ip_meta.get("exposure_level"),
                attribution_source=ip_meta.get("attribution_source"),
                attribution_confidence=ip_meta.get("attribution_confidence"),
                last_scanned_at=datetime.utcnow(),
                last_scan_duration_ms=duration_ms,
                scan_metadata={
                    "intensity": intensity,
                    "toolchain": toolchain,
                },
                score_explanation=ip_meta.get("score_explanation"),
            )
        )
        inserted += 1

    # Persist extended step results (ports/services/ssl/changes) using shared handlers.
    counts = {
        "ports": 0,
        "services": 0,
        "ssl": 0,
        "changes": 0,
    }
    for step in payload.get("pipeline", []):
        if step.get("status") != "COMPLETED":
            continue
        step_name = step.get("step", "")
        if step_name not in {"common_port_scan", "service_fingerprint", "tls_metadata", "change_detection"}:
            continue
        step_asset_id = step.get("asset_id") or _first_asset_id(payload)
        if not step_asset_id:
            continue
        step_counts = await store_step_data(
            db=db,
            job_id=job_id,
            step_name=step_name,
            result=step.get("result", {}) or {},
            asset_id=step_asset_id,
        )
        for k in counts:
            counts[k] += int(step_counts.get(k, 0))

    run.status = status
    run.completed_at = datetime.utcnow()
    run.summary = {
        "intensity": intensity,
        "ips": {
            "total": len(ip_asset_map),
            "inserted": inserted,
            "updated": updated,
        },
        "ports": {"inserted": counts["ports"]},
        "services": {"inserted": counts["services"]},
        "ssl": {"inserted": counts["ssl"]},
        "changes": {"inserted": counts["changes"]},
        "pipeline_steps": len(payload.get("pipeline", [])),
    }

    await db.commit()
    logger.info(
        "IP ASM Completed job=%s ips(total=%d inserted=%d updated=%d) ports=%d services=%d ssl=%d changes=%d",
        job_id,
        len(ip_asset_map),
        inserted,
        updated,
        counts["ports"],
        counts["services"],
        counts["ssl"],
        counts["changes"],
    )


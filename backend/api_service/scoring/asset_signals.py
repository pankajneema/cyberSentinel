"""Real ASM signal gathering for asset exposure scoring.

Pulls an asset's discovered IPs / open ports / TLS issues from the org's ASM
scan data so scoring/exposure.py can compute a defensible score. No fake or
random numbers: if there is no scan data for the asset, signals are None and
the asset stays "Unscanned".

Used by both the rescore endpoint (routes/assets.py) and the scheduler's
auto-score pass (asm/service.py).
"""

from __future__ import annotations

import ipaddress
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.asm_models import (
    AsmAdminEndpoint as AsmAdminEndpointModel,
    AsmAPIEndpoint as AsmAPIEndpointModel,
    AsmBackupFile as AsmBackupFileModel,
    AsmDiscovery as AsmDiscoveryModel,
    AsmIP as AsmIPModel,
    AsmPort as AsmPortModel,
    AsmSSLCert as AsmSSLCertModel,
)
from scoring import AssetSignals


async def _load_org_scan_data(db: AsyncSession, org_id: str) -> dict:
    """Load an org's discovery ids + all IPs/certs/open-ports/admin-endpoints/
    backup-files/API-endpoints once. Used to memoize per-org scan data across a
    batch of assets (kills the auto-score N+1: the scheduler passes a shared
    cache so this runs once per org per tick instead of 3-4 full scans per
    asset)."""
    disc_ids = (
        await db.execute(
            select(AsmDiscoveryModel.id).filter(AsmDiscoveryModel.org_id == org_id)
        )
    ).scalars().all()
    if not disc_ids:
        return {
            "disc_ids": [], "ips": [], "certs": [], "ports": [],
            "admin_endpoints": [], "backup_files": [], "api_endpoints": [],
        }
    ips = (await db.execute(
        select(AsmIPModel).filter(AsmIPModel.asm_discovery_id.in_(disc_ids)))).scalars().all()
    certs = (await db.execute(
        select(AsmSSLCertModel).filter(AsmSSLCertModel.asm_discovery_id.in_(disc_ids)))).scalars().all()
    ports = (await db.execute(
        select(AsmPortModel).filter(
            AsmPortModel.asm_discovery_id.in_(disc_ids),
            AsmPortModel.status == "open"))).scalars().all()
    admin_endpoints = (await db.execute(
        select(AsmAdminEndpointModel).filter(
            AsmAdminEndpointModel.asm_discovery_id.in_(disc_ids)))).scalars().all()
    backup_files = (await db.execute(
        select(AsmBackupFileModel).filter(
            AsmBackupFileModel.asm_discovery_id.in_(disc_ids)))).scalars().all()
    api_endpoints = (await db.execute(
        select(AsmAPIEndpointModel).filter(
            AsmAPIEndpointModel.asm_discovery_id.in_(disc_ids)))).scalars().all()
    return {
        "disc_ids": disc_ids, "ips": ips, "certs": certs, "ports": ports,
        "admin_endpoints": admin_endpoints, "backup_files": backup_files,
        "api_endpoints": api_endpoints,
    }


async def _gather_asset_signals(
    db: AsyncSession, org_id: str, asset, cache: dict | None = None
) -> tuple[AssetSignals | None, list[str]]:
    """Collect real ASM signals (open ports, TLS issues) for an asset, matched
    by name within the org's discoveries. Returns (signals, matched_ips).
    signals is None when no scan data matches the asset.

    `cache` (optional): a dict keyed by org_id memoizing the org's scan rows so a
    batch of assets shares one set of bulk queries (see _load_org_scan_data)."""
    if cache is not None:
        data = cache.get(org_id)
        if data is None:
            data = await _load_org_scan_data(db, org_id)
            cache[org_id] = data
    else:
        data = await _load_org_scan_data(db, org_id)
    disc_ids = data["disc_ids"]
    if not disc_ids:
        return None, []

    name = (asset.name or "").strip().lower()
    ip_rows = data["ips"]

    matched_ips: set[str] = set()
    if asset.type == "ip":
        # Direct IP / CIDR membership match.
        try:
            net = ipaddress.ip_network(asset.name, strict=False)
        except ValueError:
            net = None
        for ip in ip_rows:
            try:
                if ip.ip_address == asset.name or (net and ipaddress.ip_address(ip.ip_address) in net):
                    matched_ips.add(ip.ip_address)
            except ValueError:
                continue
    elif asset.type == "domain":
        for ip in ip_rows:
            sub = (ip.subdomain or "").lower()
            if sub == name or sub.endswith("." + name):
                matched_ips.add(ip.ip_address)

    # TLS issues on hosts that belong to this asset (expired certs).
    tls_issues: list[str] = []
    if asset.type in ("domain", "ip"):
        certs = data["certs"]
        now = datetime.utcnow()
        for c in certs:
            host = (c.host or "").lower()
            belongs = (
                host in matched_ips
                or host == name
                or host.endswith("." + name)
            )
            if belongs and c.valid_until and c.valid_until < now:
                tls_issues.append("expired")

    # Exposed admin panels / backup files / API endpoints — stored with the
    # scanned asset's own id, so match directly rather than via IP/name.
    admin_count = sum(1 for e in data["admin_endpoints"] if e.asset_id == asset.id)
    backup_count = sum(1 for b in data["backup_files"] if b.asset_id == asset.id)
    api_count = sum(1 for a in data["api_endpoints"] if a.asset_id == asset.id)

    if not matched_ips and not tls_issues and not admin_count and not backup_count and not api_count:
        return None, []

    # Open ports across all matched IPs.
    open_ports: list[int] = []
    services: list[str] = []
    if matched_ips:
        matched_set = set(matched_ips)
        # Filter the org's open ports (already loaded) in memory.
        for p in data["ports"]:
            if p.ip_address in matched_set:
                open_ports.append(p.port)
                if p.service:
                    services.append(p.service)

    signals = AssetSignals(
        open_ports=open_ports,
        services=services,
        is_public=(asset.exposure == "public"),
        tls_issues=tls_issues,
        admin_endpoints=admin_count,
        backup_files=backup_count,
        exposed_api_endpoints=api_count,
        asset_criticality=(asset.criticality or "normal"),
    )
    return signals, sorted(matched_ips)

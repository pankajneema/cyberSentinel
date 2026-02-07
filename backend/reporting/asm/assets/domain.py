"""
Domain ASM Reporting - Process discovered subdomains from pipeline results
"""

import logging
from typing import Any
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from backend.api_service.models.asm_models import (
    AsmDiscoveryRun, AsmSubdomain, AsmDiscovery, AsmIP,
    AsmPort, AsmService, AsmSSLCert, AsmAPIEndpoint,
    AsmCloudResource, AsmAdminEndpoint, AsmBackupFile
)

logger = logging.getLogger(__name__)


# -------------------------
# Utils
# -------------------------

def extract_ips(payload: dict[str, Any]) -> list[tuple[str, str, str | None]]:
    """Return list of (asset_id, ip_address, subdomain) tuples extracted from pipeline.
    
    Extracts IPs from:
    - dns_resolution step results
    - ip_mapping step results
    """
    entries: list[tuple[str, str, str | None]] = []
    pipeline = payload.get("pipeline", [])

    for step in pipeline:
        if step.get("status") != "COMPLETED":
            continue

        step_name = step.get("step", "")
        asset_id = step.get("asset_id") or payload.get("asset_id")
        result = step.get("result", {})
        
        # Extract IPs from dns_resolution or ip_mapping steps
        if step_name in ["dns_resolution", "ip_mapping"]:
            # Handle different result structures
            ips_data = []
            
            # Case 1: result.resolved (array of objects with subdomain and ips) - dns_resolution format
            if "resolved" in result:
                resolved = result["resolved"]
                if isinstance(resolved, list):
                    for item in resolved:
                        if isinstance(item, dict):
                            subdomain = item.get("subdomain")
                            ips = item.get("ips") or item.get("ip") or []
                            if isinstance(ips, str):
                                ips = [ips]
                            elif not isinstance(ips, list):
                                continue
                            
                            for ip in ips:
                                if ip:
                                    entries.append((asset_id, str(ip).strip(), subdomain))
            
            # Case 2: result.ips (array of objects with subdomain and ips) - ip_mapping format
            elif "ips" in result:
                ips = result["ips"]
                if isinstance(ips, list):
                    for item in ips:
                        if isinstance(item, dict):
                            # ip_mapping format: {"subdomain": "...", "ips": [...]}
                            subdomain = item.get("subdomain")
                            ip_list = item.get("ips") or []
                            if isinstance(ip_list, str):
                                ip_list = [ip_list]
                            elif not isinstance(ip_list, list):
                                continue
                            
                            for ip in ip_list:
                                if ip:
                                    entries.append((asset_id, str(ip).strip(), subdomain))
                        elif isinstance(item, str):
                            # Direct IP string
                            entries.append((asset_id, item.strip(), None))
            
            # Case 3: result.data (array of IP strings or dicts)
            elif "data" in result:
                data = result["data"]
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, str):
                            entries.append((asset_id, item.strip(), None))
                        elif isinstance(item, dict):
                            ip = item.get("ip") or item.get("ip_address") or item.get("value")
                            subdomain = item.get("subdomain")
                            if ip:
                                entries.append((asset_id, str(ip).strip(), subdomain))

    return entries


def extract_subdomains(payload: dict[str, Any]) -> list[tuple[str, str]]:
    """Return list of (asset_id, subdomain) pairs extracted from completed steps.
    
    Supports multiple result formats:
    - result.data (array of strings or dicts)
    - result.subdomains (array of strings)
    - result (direct array)
    """
    entries: list[tuple[str, str]] = []
    pipeline = payload.get("pipeline", [])

    for step in pipeline:
        if step.get("status") != "COMPLETED":
            continue

        asset_id = step.get("asset_id") or payload.get("asset_id")
        step_name = step.get("step", "")
        result = step.get("result", {})
        
        # Handle different result structures
        subdomains = []
        
        # Case 1: result.data (array)
        if "data" in result:
            data = result["data"]
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, str):
                        subdomains.append(item)
                    elif isinstance(item, dict):
                        # Try common keys
                        subdomain = item.get("subdomain") or item.get("name") or item.get("value")
                        if subdomain:
                            subdomains.append(subdomain)
        
        # Case 2: result.subdomains (direct array)
        elif "subdomains" in result:
            subdomains_data = result["subdomains"]
            if isinstance(subdomains_data, list):
                subdomains.extend([str(s) for s in subdomains_data if s])
        
        # Case 3: result is direct array (for backward compatibility)
        elif isinstance(result, list):
            subdomains.extend([str(s) for s in result if s])
        
        # Case 4: Check if result itself is a string (single subdomain)
        elif isinstance(result, str):
            subdomains.append(result)
        
        # Extract subdomains and pair with asset_id
        for subdomain in subdomains:
            if subdomain and asset_id:
                entries.append((asset_id, subdomain.strip()))
            elif subdomain:
                # Fallback: use first asset_id from payload if step doesn't have one
                fallback_asset_id = payload.get("asset_id")
                if fallback_asset_id:
                    entries.append((fallback_asset_id, subdomain.strip()))
                else:
                    logger.warning(f"Skipping subdomain '{subdomain}' - no asset_id found")

    return entries


async def get_user_id_from_discovery(db: AsyncSession, discovery_id: str) -> str | None:
    """Get user_id from asm_discoveries table by discovery_id."""
    try:
        query = select(AsmDiscovery.user_id).where(AsmDiscovery.id == discovery_id)
        result = await db.execute(query)
        user_id = result.scalar_one_or_none()
        return user_id
    except Exception as e:
        logger.error(f"Failed to fetch user_id for discovery {discovery_id}: {e}")
        return None


# -------------------------
# Main Processor
# -------------------------

async def process_domain_asm(db: AsyncSession, payload: dict[str, Any]) -> None:
    """Process domain ASM pipeline results and store in database.
    
    This function:
    1. Gets user_id from asm_discoveries table
    2. Creates or updates AsmDiscoveryRun record
    3. Extracts and inserts subdomains (handles duplicates gracefully)
    4. Updates run status and summary
    """
    job_id = payload.get("job_id")
    intensity = payload.get("intensity", "LIGHT")
    status = payload.get("status", "COMPLETED")

    logger.info(f"Processing ASM job={job_id} intensity={intensity} status={status}")

    # Get user_id from asm_discoveries table
    user_id = await get_user_id_from_discovery(db, job_id)
    if not user_id:
        logger.warning(f"Could not find user_id for discovery {job_id}, using 'system'")
        user_id = "system"

    # Get asset_id from first step or payload
    asset_id = payload.get("asset_id")
    if not asset_id:
        pipeline = payload.get("pipeline", [])
        for step in pipeline:
            step_asset_id = step.get("asset_id")
            if step_asset_id:
                asset_id = step_asset_id
                break
    
    if not asset_id:
        logger.warning(f"No asset_id found in payload or pipeline for job={job_id}, using empty string")
        asset_id = ""

    # Extract subdomains from pipeline results
    subdomain_entries = extract_subdomains(payload)
    logger.info(f"Extracted {len(subdomain_entries)} subdomain entries from pipeline")

    run = None

    try:
        # -------------------------
        # Check if run already exists (avoid duplicates)
        # -------------------------
        existing_run_query = select(AsmDiscoveryRun).where(
            AsmDiscoveryRun.asm_discovery_id == job_id
        ).order_by(AsmDiscoveryRun.created_at.desc())
        existing_run_result = await db.execute(existing_run_query)
        existing_run = existing_run_result.scalar_one_or_none()

        if existing_run:
            logger.info(f"Found existing run id={existing_run.id} for job={job_id}, updating...")
            run = existing_run
            # Update existing run
            if not run.started_at:
                run.started_at = datetime.utcnow()
            run.status = "RUNNING"
        else:
            # -------------------------
            # Create New Run
            # -------------------------
            run = AsmDiscoveryRun(
                asm_discovery_id=job_id,
                user_id=user_id,
                triggered_by="API",
                run_mode="QUICK",
                status="RUNNING",
                started_at=datetime.utcnow()
            )
            db.add(run)
            await db.flush()  # Flush to get run.id

        await db.commit()
        await db.refresh(run)

        # -------------------------
        # Insert Subdomains (with duplicate handling)
        # -------------------------
        inserted = 0
        skipped = 0
        errors = 0

        for asset_id, subdomain in subdomain_entries:
            if not asset_id or not subdomain:
                skipped += 1
                continue

            try:
                obj = AsmSubdomain(
                    asm_discovery_id=job_id,
                    asset_id=asset_id,
                    subdomain=subdomain.strip(),
                    status="active"  # Default status
                )
                db.add(obj)
                await db.flush()  # Try to insert
                inserted += 1
            except IntegrityError:
                # Duplicate subdomain - skip gracefully
                await db.rollback()
                skipped += 1
                logger.debug(f"Skipping duplicate subdomain: {subdomain} for asset={asset_id}")
            except Exception as e:
                await db.rollback()
                errors += 1
                logger.warning(f"Error inserting subdomain {subdomain}: {e}")

        # -------------------------
        # Insert IPs (from dns_resolution and ip_mapping steps)
        # HIERARCHY: IP belongs to Subdomain (subdomain_id links them)
        # -------------------------
        ip_entries = extract_ips(payload)
        logger.info(f"Extracted {len(ip_entries)} IP entries from pipeline")
        
        # Build a lookup map: (asset_id, subdomain_name) -> subdomain_id
        # This allows us to link IPs to their parent subdomains
        subdomain_lookup = {}
        if subdomain_entries:
            # Query all subdomains for this discovery to build lookup
            subdomain_query = select(AsmSubdomain).where(
                AsmSubdomain.asm_discovery_id == job_id
            )
            subdomain_result = await db.execute(subdomain_query)
            all_subdomains = subdomain_result.scalars().all()
            
            for sd in all_subdomains:
                key = (sd.asset_id, sd.subdomain.lower().strip())
                subdomain_lookup[key] = sd.id
        
        ip_inserted = 0
        ip_skipped = 0
        ip_errors = 0

        for asset_id, ip_address, subdomain_name in ip_entries:
            if not asset_id or not ip_address:
                ip_skipped += 1
                continue

            # Find subdomain_id if subdomain name is provided
            subdomain_id = None
            if subdomain_name:
                lookup_key = (asset_id, subdomain_name.lower().strip())
                subdomain_id = subdomain_lookup.get(lookup_key)
                if not subdomain_id:
                    logger.debug(f"Could not find subdomain_id for '{subdomain_name}' (asset={asset_id}), IP will be inserted without parent link")

            try:
                obj = AsmIP(
                    asm_discovery_id=job_id,
                    asset_id=asset_id,
                    ip_address=ip_address.strip(),
                    subdomain_id=subdomain_id,  # Hierarchy link to parent subdomain
                    subdomain=subdomain_name.strip() if subdomain_name else None,  # Denormalized name
                    status="active"  # Default status
                )
                db.add(obj)
                await db.flush()  # Try to insert
                ip_inserted += 1
            except IntegrityError:
                # Duplicate IP - skip gracefully
                await db.rollback()
                ip_skipped += 1
                logger.debug(f"Skipping duplicate IP: {ip_address} for asset={asset_id}")
            except Exception as e:
                await db.rollback()
                ip_errors += 1
                logger.warning(f"Error inserting IP {ip_address}: {e}")

        # Commit all successful inserts
        await db.commit()

        # -------------------------
        # Store Additional ASM Data (Ports, Services, SSL, APIs, etc.)
        # NOTE: This is for backward compatibility - incremental storage happens in handle_step_event
        # -------------------------
        # Build IP lookup map for linking ports/services to IPs
        ip_lookup = {}
        ip_query = select(AsmIP).where(AsmIP.asm_discovery_id == job_id)
        ip_result = await db.execute(ip_query)
        all_ips = ip_result.scalars().all()
        for ip_obj in all_ips:
            key = (ip_obj.asset_id, ip_obj.ip_address.strip())
            ip_lookup[key] = ip_obj.id

        # Store data from all completed steps
        ports_inserted = 0
        services_inserted = 0
        ssl_inserted = 0
        api_inserted = 0
        cloud_inserted = 0
        admin_inserted = 0
        backup_inserted = 0
        
        pipeline = payload.get("pipeline", [])
        logger.info(f"Processing {len(pipeline)} pipeline steps for job={job_id}")
        
        for step in pipeline:
            step_status = step.get("status")
            if step_status != "COMPLETED":
                logger.debug(f"Skipping step {step.get('step')} - status={step_status}")
                continue
            
            step_name = step.get("step", "")
            result = step.get("result", {})
            step_asset_id = step.get("asset_id") or asset_id or ""
            
            if not step_asset_id:
                logger.warning(f"No asset_id for step {step_name}, skipping storage")
                continue
            
            logger.info(f"Processing step: {step_name} for asset_id={step_asset_id}")
            
            # Debug: Log result structure
            result_keys = list(result.keys()) if isinstance(result, dict) else "not a dict"
            result_sample = str(result)[:500] if result else "empty"
            logger.debug(f"Step {step_name} result: keys={result_keys}, sample={result_sample}")
            
            if step_name == "common_port_scan":
                count = await store_ports(db, job_id, result, step_asset_id, ip_lookup, subdomain_lookup)
                ports_inserted += count
                logger.info(f"Stored {count} ports from {step_name}")
            elif step_name == "service_fingerprint":
                count = await store_services(db, job_id, result, step_asset_id, ip_lookup)
                services_inserted += count
                logger.info(f"Stored {count} services from {step_name}")
            elif step_name == "tls_metadata":
                count = await store_ssl_certs(db, job_id, result, step_asset_id, subdomain_lookup)
                ssl_inserted += count
                logger.info(f"Stored {count} SSL certs from {step_name}")
            elif step_name == "api_surface_hint":
                count = await store_api_endpoints(db, job_id, result, step_asset_id, subdomain_lookup)
                api_inserted += count
                logger.info(f"Stored {count} API endpoints from {step_name}")
            elif step_name == "cloud_exposure_detect":
                count = await store_cloud_resources(db, job_id, result, step_asset_id)
                cloud_inserted += count
                logger.info(f"Stored {count} cloud resources from {step_name}")
            elif step_name == "admin_endpoint_check":
                count = await store_admin_endpoints(db, job_id, result, step_asset_id, subdomain_lookup)
                admin_inserted += count
                logger.info(f"Stored {count} admin endpoints from {step_name}")
            elif step_name == "backup_file_check":
                count = await store_backup_files(db, job_id, result, step_asset_id, subdomain_lookup)
                backup_inserted += count
                logger.info(f"Stored {count} backup files from {step_name}")
            else:
                logger.debug(f"No storage handler for step: {step_name}")
        
        await db.commit()
        logger.info(f"Completed storing additional data: ports={ports_inserted} services={services_inserted} ssl={ssl_inserted} api={api_inserted} cloud={cloud_inserted} admin={admin_inserted} backup={backup_inserted}")

        # -------------------------
        # Complete Run
        # -------------------------
        run.status = status  # Use status from payload (COMPLETED or FAILED)
        run.completed_at = datetime.utcnow()
        # Extract additional data from pipeline steps (ports, services, SSL, APIs, etc.)
        ports_found = 0
        services_found = 0
        ssl_analyzed = 0
        api_endpoints_found = 0
        cloud_resources_found = 0
        admin_endpoints_found = 0
        
        pipeline = payload.get("pipeline", [])
        for step in pipeline:
            if step.get("status") != "COMPLETED":
                continue
            step_name = step.get("step", "")
            result = step.get("result", {})
            
            if step_name == "common_port_scan":
                ports_data = result.get("ports", [])
                if isinstance(ports_data, list):
                    ports_found = len(ports_data)
            
            elif step_name == "service_fingerprint":
                services_data = result.get("services", [])
                if isinstance(services_data, list):
                    services_found = len(services_data)
            
            elif step_name == "tls_metadata":
                ssl_data = result.get("ssl_results", [])
                if isinstance(ssl_data, list):
                    ssl_analyzed = len(ssl_data)
            
            elif step_name == "api_surface_hint":
                endpoints_data = result.get("endpoints", [])
                if isinstance(endpoints_data, list):
                    api_endpoints_found = len(endpoints_data)
            
            elif step_name == "cloud_exposure_detect":
                resources_data = result.get("resources", [])
                if isinstance(resources_data, list):
                    cloud_resources_found = len(resources_data)
            
            elif step_name == "admin_endpoint_check":
                admin_data = result.get("admin_endpoints", [])
                if isinstance(admin_data, list):
                    admin_endpoints_found = len(admin_data)

        run.summary = {
            "subdomains": {
                "found": len(subdomain_entries),
                "inserted": inserted,
                "skipped": skipped,
                "errors": errors,
            },
            "ips": {
                "found": len(ip_entries),
                "inserted": ip_inserted,
                "skipped": ip_skipped,
                "errors": ip_errors,
            },
            "ports": {
                "found": ports_found,
                "inserted": ports_inserted,
            },
            "services": {
                "found": services_found,
                "inserted": services_inserted,
            },
            "ssl": {
                "analyzed": ssl_analyzed,
                "inserted": ssl_inserted,
            },
            "api_endpoints": {
                "found": api_endpoints_found,
                "inserted": api_inserted,
            },
            "cloud_resources": {
                "found": cloud_resources_found,
                "inserted": cloud_inserted,
            },
            "admin_endpoints": {
                "found": admin_endpoints_found,
                "inserted": admin_inserted,
            },
            "backup_files": {
                "inserted": backup_inserted,
            },
            "intensity": intensity,
            "pipeline_steps": len(pipeline)
        }

        await db.commit()

        logger.info(
            f"✅ ASM Completed job={job_id} "
            f"subdomains: inserted={inserted} skipped={skipped} errors={errors} | "
            f"IPs: inserted={ip_inserted} skipped={ip_skipped} errors={ip_errors} | "
            f"Ports: {ports_inserted} | Services: {services_inserted} | SSL: {ssl_inserted} | "
            f"APIs: {api_inserted} | Cloud: {cloud_inserted} | Admin: {admin_inserted} | Backup: {backup_inserted}"
        )

    except Exception as e:
        logger.error(f"ASM Failed job={job_id} error={e}", exc_info=True)

        if run:
            try:
                run.status = "FAILED"
                run.error_message = str(e)[:500]  # Limit error message length
                if not run.completed_at:
                    run.completed_at = datetime.utcnow()
                await db.commit()
            except Exception as commit_err:
                logger.error(f"Failed to update run status: {commit_err}")

        raise


# -------------------------
# Incremental Storage Functions (called per step event)
# -------------------------

async def store_step_data(
    db: AsyncSession,
    job_id: str,
    step_name: str,
    result: dict[str, Any],
    asset_id: str,
    subdomain_lookup: dict[tuple[str, str], str] = None,
    ip_lookup: dict[tuple[str, str], str] = None
) -> dict[str, int]:
    """Store data from a single step incrementally.
    
    Returns dict with counts: {"ports": 5, "services": 3, ...}
    """
    counts = {
        "ports": 0,
        "services": 0,
        "ssl": 0,
        "api_endpoints": 0,
        "cloud_resources": 0,
        "admin_endpoints": 0,
        "backup_files": 0,
    }
    
    # Build lookups if not provided
    if subdomain_lookup is None:
        subdomain_lookup = {}
        subdomain_query = select(AsmSubdomain).where(AsmSubdomain.asm_discovery_id == job_id)
        subdomain_result = await db.execute(subdomain_query)
        all_subdomains = subdomain_result.scalars().all()
        for sd in all_subdomains:
            key = (sd.asset_id, sd.subdomain.lower().strip())
            subdomain_lookup[key] = sd.id
    
    if ip_lookup is None:
        ip_lookup = {}
        ip_query = select(AsmIP).where(AsmIP.asm_discovery_id == job_id)
        ip_result = await db.execute(ip_query)
        all_ips = ip_result.scalars().all()
        for ip_obj in all_ips:
            key = (ip_obj.asset_id, ip_obj.ip_address.strip())
            ip_lookup[key] = ip_obj.id
    
    # Route to appropriate storage function based on step name
    if step_name == "common_port_scan":
        counts["ports"] = await store_ports(db, job_id, result, asset_id, ip_lookup, subdomain_lookup)
    elif step_name == "service_fingerprint":
        counts["services"] = await store_services(db, job_id, result, asset_id, ip_lookup)
    elif step_name == "tls_metadata":
        counts["ssl"] = await store_ssl_certs(db, job_id, result, asset_id, subdomain_lookup)
    elif step_name == "api_surface_hint":
        counts["api_endpoints"] = await store_api_endpoints(db, job_id, result, asset_id, subdomain_lookup)
    elif step_name == "cloud_exposure_detect":
        counts["cloud_resources"] = await store_cloud_resources(db, job_id, result, asset_id)
    elif step_name == "admin_endpoint_check":
        counts["admin_endpoints"] = await store_admin_endpoints(db, job_id, result, asset_id, subdomain_lookup)
    elif step_name == "backup_file_check":
        counts["backup_files"] = await store_backup_files(db, job_id, result, asset_id, subdomain_lookup)
    
    return counts


async def store_ports(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    ip_lookup: dict[tuple[str, str], str],
    subdomain_lookup: dict[tuple[str, str], str]
) -> int:
    """Extract and store ports from common_port_scan step result."""
    inserted = 0
    
    # Debug: Log the result structure
    logger.debug(f"store_ports: result keys={list(result.keys())}, result={result}")
    
    ports_data = result.get("ports", [])
    
    if not isinstance(ports_data, list):
        logger.warning(f"store_ports: ports_data is not a list, type={type(ports_data)}, value={ports_data}")
        return 0
    
    logger.info(f"store_ports: Found {len(ports_data)} ports in result")
    
    for port_item in ports_data:
        if not isinstance(port_item, dict):
            continue
        
        ip_address = port_item.get("ip", "")
        port = port_item.get("port")
        protocol = port_item.get("protocol", "tcp")
        
        if not ip_address or not port:
            continue
        
        # Find IP ID
        ip_id = None
        lookup_key = (asset_id, ip_address.strip())
        ip_id = ip_lookup.get(lookup_key)
        
        # Find subdomain_id from IP
        subdomain_id = None
        if ip_id:
            ip_query = select(AsmIP).where(AsmIP.id == ip_id)
            ip_result = await db.execute(ip_query)
            ip_obj = ip_result.scalar_one_or_none()
            if ip_obj:
                subdomain_id = ip_obj.subdomain_id
        
        try:
            obj = AsmPort(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                ip_address=ip_address.strip(),
                ip_id=ip_id,
                subdomain_id=subdomain_id,
                port=int(port),
                protocol=protocol,
                status="open",
                service=port_item.get("service"),
                banner=port_item.get("banner"),
            )
            db.add(obj)
            await db.flush()
            inserted += 1
        except IntegrityError:
            await db.rollback()
        except Exception as e:
            await db.rollback()
            logger.warning(f"Error inserting port {ip_address}:{port}: {e}")
    
    return inserted


async def store_services(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    ip_lookup: dict[tuple[str, str], str]
) -> int:
    """Extract and store services from service_fingerprint step result."""
    inserted = 0
    
    # Debug: Log the result structure
    logger.debug(f"store_services: result keys={list(result.keys())}, result={result}")
    
    services_data = result.get("services", [])
    
    if not isinstance(services_data, list):
        logger.warning(f"store_services: services_data is not a list, type={type(services_data)}, value={services_data}")
        return 0
    
    logger.info(f"store_services: Found {len(services_data)} services in result")
    
    for service_item in services_data:
        if not isinstance(service_item, dict):
            continue
        
        ip_address = service_item.get("ip", "")
        port = service_item.get("port")
        service_name = service_item.get("service", "")
        
        if not ip_address or not port or not service_name:
            continue
        
        # Find IP ID
        ip_id = None
        lookup_key = (asset_id, ip_address.strip())
        ip_id = ip_lookup.get(lookup_key)
        
        # Find port_id
        port_id = None
        if ip_id:
            port_query = select(AsmPort).where(
                AsmPort.ip_address == ip_address.strip(),
                AsmPort.port == int(port)
            ).limit(1)
            port_result = await db.execute(port_query)
            port_obj = port_result.scalar_one_or_none()
            if port_obj:
                port_id = port_obj.id
        
        try:
            obj = AsmService(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                ip_address=ip_address.strip(),
                port=int(port),
                port_id=port_id,
                ip_id=ip_id,
                service_name=service_name,
                version=service_item.get("version"),
                product=service_item.get("product"),
                extra_info=service_item.get("extra_info"),
            )
            db.add(obj)
            await db.flush()
            inserted += 1
        except IntegrityError:
            await db.rollback()
        except Exception as e:
            await db.rollback()
            logger.warning(f"Error inserting service {ip_address}:{port}:{service_name}: {e}")
    
    return inserted


async def store_ssl_certs(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    subdomain_lookup: dict[tuple[str, str], str]
) -> int:
    """Extract and store SSL certificates from tls_metadata step result."""
    inserted = 0
    
    # Debug: Log the result structure
    logger.debug(f"store_ssl_certs: result keys={list(result.keys())}, result={result}")
    
    ssl_data = result.get("ssl_results", [])
    
    if not isinstance(ssl_data, list):
        logger.warning(f"store_ssl_certs: ssl_data is not a list, type={type(ssl_data)}, value={ssl_data}")
        return 0
    
    logger.info(f"store_ssl_certs: Found {len(ssl_data)} SSL results in result")
    
    for ssl_item in ssl_data:
        if not isinstance(ssl_item, dict):
            continue
        
        host = ssl_item.get("host", "")
        port = ssl_item.get("port", 443)
        
        if not host:
            continue
        
        # Find subdomain_id
        subdomain_id = None
        subdomain = host.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
        lookup_key = (asset_id, subdomain.lower().strip())
        subdomain_id = subdomain_lookup.get(lookup_key)
        
        try:
            obj = AsmSSLCert(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                host=host.strip(),
                port=int(port),
                subdomain_id=subdomain_id,
                protocol=ssl_item.get("protocol"),
                cipher=ssl_item.get("cipher"),
                certificate_issuer=ssl_item.get("issuer"),
                certificate_subject=ssl_item.get("certificate"),
                valid_until=ssl_item.get("valid_until"),
                certificate_details=ssl_item,
            )
            db.add(obj)
            await db.flush()
            inserted += 1
        except IntegrityError:
            await db.rollback()
        except Exception as e:
            await db.rollback()
            logger.warning(f"Error inserting SSL cert {host}:{port}: {e}")
    
    return inserted


async def store_api_endpoints(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    subdomain_lookup: dict[tuple[str, str], str]
) -> int:
    """Extract and store API endpoints from api_surface_hint step result."""
    inserted = 0
    
    # Debug: Log the result structure
    logger.debug(f"store_api_endpoints: result keys={list(result.keys())}, result={result}")
    
    endpoints_data = result.get("endpoints", [])
    
    if not isinstance(endpoints_data, list):
        logger.warning(f"store_api_endpoints: endpoints_data is not a list, type={type(endpoints_data)}, value={endpoints_data}")
        return 0
    
    logger.info(f"store_api_endpoints: Found {len(endpoints_data)} endpoints in result")
    
    for endpoint_item in endpoints_data:
        if not isinstance(endpoint_item, dict):
            continue
        
        url = endpoint_item.get("url", "")
        if not url:
            continue
        
        # Extract subdomain from URL
        subdomain_id = None
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            subdomain = parsed.netloc.split(":")[0]
            lookup_key = (asset_id, subdomain.lower().strip())
            subdomain_id = subdomain_lookup.get(lookup_key)
        except:
            pass
        
        try:
            obj = AsmAPIEndpoint(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                url=url.strip(),
                subdomain_id=subdomain_id,
                method=endpoint_item.get("method"),
                status_code=endpoint_item.get("status"),
                endpoint_type=endpoint_item.get("type", "api"),
                extra_info=endpoint_item,
            )
            db.add(obj)
            await db.flush()
            inserted += 1
        except IntegrityError:
            await db.rollback()
        except Exception as e:
            await db.rollback()
            logger.warning(f"Error inserting API endpoint {url}: {e}")
    
    return inserted


async def store_cloud_resources(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str
) -> int:
    """Extract and store cloud resources from cloud_exposure_detect step result."""
    inserted = 0
    resources_data = result.get("resources", [])
    
    if not isinstance(resources_data, list):
        return 0
    
    for resource_item in resources_data:
        if not isinstance(resource_item, dict):
            continue
        
        service = resource_item.get("service", "")
        resource_type = resource_item.get("type", "")
        resource_name = resource_item.get("name", "")
        
        if not service or not resource_name:
            continue
        
        try:
            obj = AsmCloudResource(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                service=service,
                resource_type=resource_type,
                resource_name=resource_name.strip(),
                access_status=resource_item.get("status"),
                extra_info=resource_item,
            )
            db.add(obj)
            await db.flush()
            inserted += 1
        except IntegrityError:
            await db.rollback()
        except Exception as e:
            await db.rollback()
            logger.warning(f"Error inserting cloud resource {resource_name}: {e}")
    
    return inserted


async def store_admin_endpoints(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    subdomain_lookup: dict[tuple[str, str], str]
) -> int:
    """Extract and store admin endpoints from admin_endpoint_check step result."""
    inserted = 0
    admin_data = result.get("admin_endpoints", [])
    
    if not isinstance(admin_data, list):
        return 0
    
    for admin_item in admin_data:
        if not isinstance(admin_item, dict):
            continue
        
        url = admin_item.get("url", "")
        if not url:
            continue
        
        # Extract subdomain from URL
        subdomain_id = None
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            subdomain = parsed.netloc.split(":")[0]
            lookup_key = (asset_id, subdomain.lower().strip())
            subdomain_id = subdomain_lookup.get(lookup_key)
        except:
            pass
        
        try:
            obj = AsmAdminEndpoint(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                url=url.strip(),
                subdomain_id=subdomain_id,
                status_code=admin_item.get("status"),
                response_size=admin_item.get("size"),
                endpoint_type="admin",
                extra_info=admin_item,
            )
            db.add(obj)
            await db.flush()
            inserted += 1
        except IntegrityError:
            await db.rollback()
        except Exception as e:
            await db.rollback()
            logger.warning(f"Error inserting admin endpoint {url}: {e}")
    
    return inserted


async def store_backup_files(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any],
    asset_id: str,
    subdomain_lookup: dict[tuple[str, str], str]
) -> int:
    """Extract and store backup files from backup_file_check step result."""
    inserted = 0
    backup_data = result.get("backup_files", [])
    
    if not isinstance(backup_data, list):
        return 0
    
    for backup_item in backup_data:
        if not isinstance(backup_item, dict):
            continue
        
        file_url = backup_item.get("url", "")
        if not file_url:
            continue
        
        # Extract subdomain from URL
        subdomain_id = None
        try:
            from urllib.parse import urlparse
            parsed = urlparse(file_url)
            subdomain = parsed.netloc.split(":")[0]
            lookup_key = (asset_id, subdomain.lower().strip())
            subdomain_id = subdomain_lookup.get(lookup_key)
        except:
            pass
        
        try:
            obj = AsmBackupFile(
                asm_discovery_id=job_id,
                asset_id=asset_id,
                file_url=file_url.strip(),
                subdomain_id=subdomain_id,
                file_extension=backup_item.get("extension"),
                status=backup_item.get("status", "checked"),
                extra_info=backup_item,
            )
            db.add(obj)
            await db.flush()
            inserted += 1
        except IntegrityError:
            await db.rollback()
        except Exception as e:
            await db.rollback()
            logger.warning(f"Error inserting backup file {file_url}: {e}")
    
    return inserted
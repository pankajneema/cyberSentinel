# models/asm_models.py

import uuid
from sqlalchemy import Column, String, DateTime, Enum, JSON, Integer, Boolean, ForeignKey, Float
from sqlalchemy.sql import func

from utils.database import Base


class AsmDiscovery(Base):
    __tablename__ = "asm_discoveries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # Tenant scope (Phase 3). Nullable during backfill, then enforced.
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(String, nullable=False)

    name = Column(String, nullable=False)
    asset_type = Column(
        Enum("domain", "ip", "cloud", "repo", "saas", "user", name="asm_asset_type"),
        nullable=False,
    )
    target_source = Column(
        Enum("FROM_ASSET", "MANUAL_ENTRY", name="asm_target_source"),
        nullable=False,
    )

    asset_ids = Column(JSON, nullable=True)
    manual_targets = Column(JSON, nullable=True)

    intensity = Column(
        Enum("LIGHT", "NORMAL", "DEEP", name="asm_intensity"),
        default="NORMAL",
    )

    # 🔥 FIXED ENUM
    schedule_type = Column(
        Enum("QUICK", "INTERVAL", "CRON", name="asm_schedule_type"),
        default="QUICK",
    )
    schedule_value = Column(String, nullable=True)

    status = Column(
        Enum("RUNNING","PENDING","PAUSED", "DELETED", "FAILED", "COMPLETED", name="asm_status"),
        default="PENDING",
    )

    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "asset_type": self.asset_type,
            "intensity": self.intensity,
            "schedule_type": self.schedule_type,
            "schedule_value": self.schedule_value,
            "status": self.status,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AsmDiscoveryRun(Base):
    __tablename__ = "asm_discovery_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(String, nullable=False)

    triggered_by = Column(
        Enum("UI", "CRON", "API", name="asm_trigger_source"),
        nullable=False,
    )

    run_mode = Column(
        Enum("QUICK", "SCHEDULED", name="asm_run_mode"),
        nullable=False,
    )

    status = Column(
        Enum("PENDING", "RUNNING", "COMPLETED", "FAILED", name="asm_run_status"),
        default="PENDING",
    )

    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(String, nullable=True)

    summary = Column(JSON, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "triggered_by": self.triggered_by,
            "run_mode": self.run_mode,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "summary": self.summary,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmSubdomain(Base):
    __tablename__ = "asm_subdomains"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    subdomain = Column(String, nullable=False)
    
    # Status: active, inactive, archived
    status = Column(String(50), default="active", nullable=False)
    
    # DNS Resolution status: true = resolved, false = unresolved, null = not checked
    resolved = Column(Boolean, nullable=True, default=None)
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique constraint on subdomain + asset_id combination
        __import__('sqlalchemy').UniqueConstraint('asset_id', 'subdomain', name='uq_subdomain_per_asset'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "subdomain": self.subdomain,
            "status": self.status,
            "resolved": self.resolved,  # DNS resolution status
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmIP(Base):
    __tablename__ = "asm_ips"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=False)
    
    # Hierarchy: IP belongs to a subdomain
    subdomain_id = Column(String, nullable=True, index=True)  # FK to asm_subdomains.id
    subdomain = Column(String, nullable=True)  # Denormalized subdomain name for quick reference
    
    # Status: active, inactive, archived
    status = Column(String(50), default="active", nullable=False)
    
    # Exposure metrics (future-ready for ASM-Medium/HIGH)
    # For ASM-LIGHT, these may be null/not calculated
    exposure_score = Column(Integer, nullable=True)  # 0-100 exposure score
    exposure_level = Column(String(20), nullable=True)  # low, medium, high, not_calculated
    reachable = Column(Boolean, nullable=True)  # HTTP/HTTPS reachable

    # Geo + network enrichment (primarily NORMAL/DEEP)
    country = Column(String, nullable=True)
    country_code = Column(String(8), nullable=True)
    region = Column(String, nullable=True)
    city = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    asn = Column(String, nullable=True)
    asn_org = Column(String, nullable=True)
    isp = Column(String, nullable=True)

    # IP ownership / attribution
    owner_org = Column(String, nullable=True)
    rdap_country = Column(String, nullable=True)
    ptr_record = Column(String, nullable=True)
    attribution_source = Column(String, nullable=True)
    attribution_confidence = Column(Integer, nullable=True)

    # Cloud/CDN attribution
    cloud_provider = Column(String, nullable=True)
    is_cloud = Column(Boolean, nullable=True)
    is_cdn = Column(Boolean, nullable=True)
    cdn_provider = Column(String, nullable=True)

    # Scan lifecycle metadata
    last_scanned_at = Column(DateTime, nullable=True)
    last_scan_duration_ms = Column(Integer, nullable=True)
    scan_metadata = Column(JSON, nullable=True)
    score_explanation = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique constraint: same IP per asset+subdomain (allows shared IPs across subdomains)
        __import__('sqlalchemy').UniqueConstraint('asset_id', 'ip_address', 'subdomain_id', name='uq_ip_per_asset_subdomain'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "ip_address": self.ip_address,
            "subdomain_id": self.subdomain_id,  # Hierarchy link
            "subdomain": self.subdomain,  # Denormalized name
            "status": self.status,
            "exposure_score": self.exposure_score,
            "exposure_level": self.exposure_level or "not_calculated",
            "reachable": self.reachable,
            "country": self.country,
            "country_code": self.country_code,
            "region": self.region,
            "city": self.city,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "asn": self.asn,
            "asn_org": self.asn_org,
            "isp": self.isp,
            "owner_org": self.owner_org,
            "rdap_country": self.rdap_country,
            "ptr_record": self.ptr_record,
            "attribution_source": self.attribution_source,
            "attribution_confidence": self.attribution_confidence,
            "cloud_provider": self.cloud_provider,
            "is_cloud": self.is_cloud,
            "is_cdn": self.is_cdn,
            "cdn_provider": self.cdn_provider,
            "last_scanned_at": self.last_scanned_at.isoformat() if self.last_scanned_at else None,
            "last_scan_duration_ms": self.last_scan_duration_ms,
            "scan_metadata": self.scan_metadata,
            "score_explanation": self.score_explanation,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmSettings(Base):
    __tablename__ = "asm_settings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # Supabase user id (JWT sub) — not an FK to the legacy users table.
    user_id = Column(String, unique=True, nullable=False, index=True)

    # Store ASM settings as JSON for flexibility
    settings = Column(JSON, nullable=False, default=dict)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "settings": self.settings or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class AsmPort(Base):
    """Stores discovered open ports on IPs"""
    __tablename__ = "asm_ports"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=False, index=True)
    
    # Hierarchy: Port belongs to an IP
    ip_id = Column(String, nullable=True, index=True)  # FK to asm_ips.id
    subdomain_id = Column(String, nullable=True, index=True)  # FK to asm_subdomains.id
    
    port = Column(Integer, nullable=False)
    protocol = Column(String(10), default="tcp", nullable=False)  # tcp, udp
    status = Column(String(50), default="open", nullable=False)  # open, closed, filtered
    
    # Metadata
    service = Column(String, nullable=True)  # Detected service name
    banner = Column(String, nullable=True)  # Service banner
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique per discovery (not global): the same IP:port discovered by two
        # discoveries must be recorded under each, otherwise shared CDN/cloud
        # IPs get attributed to only the first discovery that found them.
        __import__('sqlalchemy').UniqueConstraint('asm_discovery_id', 'ip_address', 'port', 'protocol', name='uq_port_per_discovery'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "ip_address": self.ip_address,
            "ip_id": self.ip_id,
            "subdomain_id": self.subdomain_id,
            "port": self.port,
            "protocol": self.protocol,
            "status": self.status,
            "service": self.service,
            "banner": self.banner,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmService(Base):
    """Stores discovered services on ports"""
    __tablename__ = "asm_services"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=False, index=True)
    port = Column(Integer, nullable=False)
    
    # Hierarchy links
    port_id = Column(String, nullable=True, index=True)  # FK to asm_ports.id
    ip_id = Column(String, nullable=True, index=True)  # FK to asm_ips.id
    
    service_name = Column(String, nullable=False)  # http, ssh, mysql, etc.
    version = Column(String, nullable=True)  # Service version
    product = Column(String, nullable=True)  # Product name
    extra_info = Column(JSON, nullable=True)  # Additional service metadata
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique per discovery (see AsmPort note above).
        __import__('sqlalchemy').UniqueConstraint('asm_discovery_id', 'ip_address', 'port', 'service_name', name='uq_service_per_discovery'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "ip_address": self.ip_address,
            "port": self.port,
            "port_id": self.port_id,
            "ip_id": self.ip_id,
            "service_name": self.service_name,
            "version": self.version,
            "product": self.product,
            "extra_info": self.extra_info,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmSSLCert(Base):
    """Stores SSL/TLS certificate information"""
    __tablename__ = "asm_ssl_certs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    host = Column(String, nullable=False, index=True)  # Subdomain or IP
    port = Column(Integer, default=443, nullable=False)
    
    # Hierarchy
    subdomain_id = Column(String, nullable=True, index=True)  # FK to asm_subdomains.id
    
    # Certificate details
    protocol = Column(String, nullable=True)  # TLS 1.2, TLS 1.3, etc.
    cipher = Column(String, nullable=True)  # Cipher suite
    certificate_issuer = Column(String, nullable=True)  # Certificate Authority
    certificate_subject = Column(String, nullable=True)  # Certificate subject
    valid_from = Column(DateTime, nullable=True)
    valid_until = Column(DateTime, nullable=True)
    certificate_details = Column(JSON, nullable=True)  # Full certificate data
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique per discovery (see AsmPort note above).
        __import__('sqlalchemy').UniqueConstraint('asm_discovery_id', 'host', 'port', name='uq_ssl_per_discovery'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "host": self.host,
            "port": self.port,
            "subdomain_id": self.subdomain_id,
            "protocol": self.protocol,
            "cipher": self.cipher,
            "certificate_issuer": self.certificate_issuer,
            "certificate_subject": self.certificate_subject,
            "valid_from": self.valid_from.isoformat() if self.valid_from else None,
            "valid_until": self.valid_until.isoformat() if self.valid_until else None,
            "certificate_details": self.certificate_details,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmAPIEndpoint(Base):
    """Stores discovered API endpoints"""
    __tablename__ = "asm_api_endpoints"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    url = Column(String, nullable=False, index=True)
    
    # Hierarchy
    subdomain_id = Column(String, nullable=True, index=True)  # FK to asm_subdomains.id
    
    method = Column(String(10), nullable=True)  # GET, POST, PUT, etc.
    status_code = Column(Integer, nullable=True)  # HTTP status code
    endpoint_type = Column(String, nullable=True)  # api, graphql, rest, etc.
    response_size = Column(Integer, nullable=True)  # Response size in bytes
    
    # Metadata
    title = Column(String, nullable=True)  # Page title
    content_type = Column(String, nullable=True)  # Content-Type header
    extra_info = Column(JSON, nullable=True)  # Additional endpoint metadata
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique constraint: same endpoint per discovery
        __import__('sqlalchemy').UniqueConstraint('asm_discovery_id', 'url', name='uq_endpoint_per_discovery'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "url": self.url,
            "subdomain_id": self.subdomain_id,
            "method": self.method,
            "status_code": self.status_code,
            "endpoint_type": self.endpoint_type,
            "response_size": self.response_size,
            "title": self.title,
            "content_type": self.content_type,
            "extra_info": self.extra_info,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmCloudResource(Base):
    """Stores discovered cloud resources (S3 buckets, storage accounts, etc.)"""
    __tablename__ = "asm_cloud_resources"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    
    service = Column(String, nullable=False)  # AWS, Azure, GCP
    resource_type = Column(String, nullable=False)  # S3, Storage, etc.
    resource_name = Column(String, nullable=False, index=True)
    
    # Access status
    access_status = Column(String, nullable=True)  # public, private, unknown
    permissions = Column(JSON, nullable=True)  # Detailed permissions if available
    
    # Metadata
    region = Column(String, nullable=True)  # Cloud region
    extra_info = Column(JSON, nullable=True)  # Additional resource metadata
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique constraint: same resource per discovery
        __import__('sqlalchemy').UniqueConstraint('asm_discovery_id', 'resource_name', name='uq_cloud_resource'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "service": self.service,
            "resource_type": self.resource_type,
            "resource_name": self.resource_name,
            "access_status": self.access_status,
            "permissions": self.permissions,
            "region": self.region,
            "extra_info": self.extra_info,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmAdminEndpoint(Base):
    """Stores discovered admin/management endpoints"""
    __tablename__ = "asm_admin_endpoints"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    url = Column(String, nullable=False, index=True)
    
    # Hierarchy
    subdomain_id = Column(String, nullable=True, index=True)  # FK to asm_subdomains.id
    
    status_code = Column(Integer, nullable=True)  # HTTP status code
    response_size = Column(Integer, nullable=True)  # Response size
    endpoint_type = Column(String, nullable=True)  # admin, login, dashboard, panel, etc.
    
    # Metadata
    title = Column(String, nullable=True)  # Page title
    content_type = Column(String, nullable=True)  # Content-Type
    extra_info = Column(JSON, nullable=True)  # Additional metadata
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique constraint: same admin endpoint per discovery
        __import__('sqlalchemy').UniqueConstraint('asm_discovery_id', 'url', name='uq_admin_endpoint'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "url": self.url,
            "subdomain_id": self.subdomain_id,
            "status_code": self.status_code,
            "response_size": self.response_size,
            "endpoint_type": self.endpoint_type,
            "title": self.title,
            "content_type": self.content_type,
            "extra_info": self.extra_info,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmBackupFile(Base):
    """Stores discovered backup files"""
    __tablename__ = "asm_backup_files"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)
    file_url = Column(String, nullable=False, index=True)
    
    # Hierarchy
    subdomain_id = Column(String, nullable=True, index=True)  # FK to asm_subdomains.id
    
    file_extension = Column(String, nullable=True)  # .bak, .backup, .old, etc.
    status = Column(String, nullable=True)  # found, accessible, protected, etc.
    file_size = Column(Integer, nullable=True)  # File size in bytes
    
    # Metadata
    content_type = Column(String, nullable=True)  # Content-Type if available
    extra_info = Column(JSON, nullable=True)  # Additional file metadata
    
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        # Unique constraint: same backup file per discovery
        __import__('sqlalchemy').UniqueConstraint('asm_discovery_id', 'file_url', name='uq_backup_file'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "file_url": self.file_url,
            "subdomain_id": self.subdomain_id,
            "file_extension": self.file_extension,
            "status": self.status,
            "file_size": self.file_size,
            "content_type": self.content_type,
            "extra_info": self.extra_info,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AsmChange(Base):
    """Stores asset change detection results"""
    __tablename__ = "asm_changes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asm_discovery_id = Column(String, ForeignKey("asm_discoveries.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    asset_id = Column(String, nullable=False, index=True)

    # Raw change output from tool
    changes = Column(JSON, nullable=True)  # list of changes
    message = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        __import__('sqlalchemy').Index('idx_asm_changes_discovery', 'asm_discovery_id'),
        __import__('sqlalchemy').Index('idx_asm_changes_asset', 'asset_id'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "asm_discovery_id": self.asm_discovery_id,
            "asset_id": self.asset_id,
            "changes": self.changes,
            "message": self.message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

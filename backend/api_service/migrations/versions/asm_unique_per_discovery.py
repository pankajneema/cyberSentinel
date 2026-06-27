"""Scope asm_ports / asm_services / asm_ssl_certs uniqueness per discovery

Previously these had GLOBAL unique constraints:
  asm_ports     (ip_address, port, protocol)
  asm_services  (ip_address, port, service_name)
  asm_ssl_certs (host, port)

A shared CDN/cloud IP:port (e.g. Cloudflare) discovered by a second discovery
then conflicted globally and was dropped, so the second discovery showed an
incomplete port/service/SSL list. Re-scope each constraint to include
asm_discovery_id so every discovery records its own findings.

Revision ID: asm_unique_per_discovery
Revises: tasks_tables
Create Date: 2026-06-27
"""
import sqlalchemy as sa
from alembic import op

revision = "asm_unique_per_discovery"
down_revision = "tasks_tables"
branch_labels = None
depends_on = None


def _has_constraint(name: str) -> bool:
    return op.get_bind().execute(
        sa.text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": name}
    ).scalar() is not None


def upgrade() -> None:
    # Drop the old global constraints if present (idempotent).
    op.execute("ALTER TABLE asm_ports DROP CONSTRAINT IF EXISTS uq_port_per_ip")
    op.execute("ALTER TABLE asm_services DROP CONSTRAINT IF EXISTS uq_service_per_port")
    op.execute("ALTER TABLE asm_ssl_certs DROP CONSTRAINT IF EXISTS uq_ssl_per_host")

    if not _has_constraint("uq_port_per_discovery"):
        op.create_unique_constraint(
            "uq_port_per_discovery", "asm_ports",
            ["asm_discovery_id", "ip_address", "port", "protocol"],
        )
    if not _has_constraint("uq_service_per_discovery"):
        op.create_unique_constraint(
            "uq_service_per_discovery", "asm_services",
            ["asm_discovery_id", "ip_address", "port", "service_name"],
        )
    if not _has_constraint("uq_ssl_per_discovery"):
        op.create_unique_constraint(
            "uq_ssl_per_discovery", "asm_ssl_certs",
            ["asm_discovery_id", "host", "port"],
        )


def downgrade() -> None:
    op.execute("ALTER TABLE asm_ports DROP CONSTRAINT IF EXISTS uq_port_per_discovery")
    op.execute("ALTER TABLE asm_services DROP CONSTRAINT IF EXISTS uq_service_per_discovery")
    op.execute("ALTER TABLE asm_ssl_certs DROP CONSTRAINT IF EXISTS uq_ssl_per_discovery")
    op.create_unique_constraint("uq_port_per_ip", "asm_ports", ["ip_address", "port", "protocol"])
    op.create_unique_constraint("uq_service_per_port", "asm_services", ["ip_address", "port", "service_name"])
    op.create_unique_constraint("uq_ssl_per_host", "asm_ssl_certs", ["host", "port"])

"""SSRF / scan-abuse guard for user-supplied scan targets.

The ASM pipeline drives real network scanners (nmap/naabu/httpx/nuclei) against
whatever target a tenant supplies. Without a destination filter, a tenant can
point a discovery at cloud-metadata (169.254.169.254), loopback, or the
platform's own RFC1918 network and use the worker as an internal port scanner /
SSRF pivot (CWE-918).

This module rejects forbidden *literal* IPs/CIDRs at API intake. Hostnames are
NOT resolved here (resolving attacker input at intake is itself an SSRF vector
and is defeated by DNS rebinding); the authoritative post-resolution filter
lives in the Go worker (see executor/runner/ip.go). A small hostname denylist
catches the obvious cases.
"""
from __future__ import annotations

import ipaddress

# Hostnames that unambiguously point at the local host or cloud metadata.
_DENY_HOSTNAMES = {
    "localhost",
    "metadata",
    "metadata.google.internal",
    "instance-data",  # AWS
}


def _network_is_forbidden(net: ipaddress._BaseNetwork) -> bool:
    """True if any address in `net` is loopback/private/link-local/reserved/etc."""
    return (
        net.is_private
        or net.is_loopback
        or net.is_link_local  # covers 169.254.0.0/16 and fe80::/10 (metadata)
        or net.is_multicast
        or net.is_reserved
        or net.is_unspecified
    )


def validate_scan_target(raw: str) -> None:
    """Raise ValueError if `raw` is a forbidden scan destination.

    Accepts a single host, IP, or CIDR string. Literal IPs/CIDRs overlapping
    loopback/private/link-local/metadata/reserved ranges are rejected. Bare
    hostnames pass (subject to the worker's post-resolution filter) except for
    the explicit local/metadata denylist.
    """
    target = (raw or "").strip()
    if not target:
        raise ValueError("Empty scan target")

    # Strip an optional scheme/port/path if a URL-ish value slipped through.
    host = target
    if "://" in host:
        host = host.split("://", 1)[1]
    host = host.split("/")[0].split("\\")[0]  # drop path; CIDR handled below
    host = host.rsplit(":", 1)[0] if host.count(":") == 1 and "." in host else host

    if host.lower() in _DENY_HOSTNAMES:
        raise ValueError(f"Forbidden scan target: {raw}")

    # CIDR?
    if "/" in target:
        try:
            net = ipaddress.ip_network(target, strict=False)
        except ValueError:
            raise ValueError(f"Invalid CIDR target: {raw}")
        if _network_is_forbidden(net):
            raise ValueError(f"Forbidden scan target (internal/reserved range): {raw}")
        return

    # Bare IP literal?
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return  # hostname — worker filters after resolution
    if _network_is_forbidden(ipaddress.ip_network(addr)):
        raise ValueError(f"Forbidden scan target (internal/reserved address): {raw}")


def validate_scan_targets(targets: list[str] | None) -> None:
    """Validate a list of targets; raises on the first forbidden entry."""
    for t in targets or []:
        validate_scan_target(t)

"""Shared DNS-TXT ownership verification.

Used by BOTH the on-demand verify endpoint (routes/assets.py) and the scheduler's
background re-check (utils/scheduler.py), so a customer who adds the TXT record
and closes the tab still gets auto-verified once DNS propagates — no manual
"check again" required.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger("cybersentinel.ownership")

# The TXT record value is "<VERIFY_PREFIX>=<token>".
VERIFY_PREFIX = "cybersentinel-site-verification"

_DNS_TIMEOUT = 3.0  # seconds, per resolver attempt

# Ownership verification asks "is this TXT record visible on the PUBLIC internet?"
# (the same view a scanner has), so query public resolvers FIRST — they're fast and
# authoritative for our purpose — and only fall back to the system resolver (None)
# if those are blocked. This also avoids stalling on a flaky local DNS.
_PUBLIC_NAMESERVERS = [["1.1.1.1", "8.8.8.8"], ["9.9.9.9", "8.8.4.4"]]
_RESOLVER_ORDER = [*_PUBLIC_NAMESERVERS, None]


def expected_txt(token: str) -> str:
    return f"{VERIFY_PREFIX}={token}"


def _resolve_txt(name: str) -> list[str]:
    """Blocking TXT lookup — always call via asyncio.to_thread (below).

    Tries the system resolver, then public resolvers, so a slow local DNS can't
    block a valid record. NXDOMAIN / NoAnswer are definitive (return []).
    """
    import dns.resolver  # dnspython

    name = name.rstrip(".")
    last_exc: Exception | None = None
    for nameservers in _RESOLVER_ORDER:
        resolver = dns.resolver.Resolver()
        if nameservers is not None:
            resolver.nameservers = nameservers
        resolver.timeout = _DNS_TIMEOUT
        resolver.lifetime = _DNS_TIMEOUT
        try:
            answers = resolver.resolve(name, "TXT")
            return [
                b.decode() if isinstance(b, bytes) else str(b)
                for rec in answers
                for b in getattr(rec, "strings", [str(rec)])
            ]
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            return []  # domain has no such record — definitive, don't retry
        except Exception as exc:  # noqa: BLE001 - timeout/servfail → try next resolver
            last_exc = exc
    if last_exc is not None:
        raise last_exc
    return []


async def domain_txt_matches(name: str, token: str) -> bool:
    """True if name's DNS TXT records contain the expected verification value.

    Runs the blocking resolver in a thread so it never stalls the event loop.
    Any resolver error (NXDOMAIN / no TXT / timeout) is treated as "not yet".
    """
    if not name or not token:
        return False
    expected = expected_txt(token)
    try:
        values = await asyncio.to_thread(_resolve_txt, name)
    except Exception:  # noqa: BLE001 - NXDOMAIN / no TXT / resolver error → not verified yet
        return False
    joined = " ".join(values).replace('"', "")
    return expected in joined

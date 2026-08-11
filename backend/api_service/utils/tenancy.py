"""
Tenancy helpers (Phase 3).

The goal is to make every data query scope by `org_id` directly, replacing the
per-request `_company_user_ids` rebuild in the ASM routes. As each route is
migrated to self-hosted auth, swap its ownership filter to `scope_to_org(...)`.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select


def scope_to_org(stmt: Select, model: Any, org_id: str) -> Select:
    """Add a tenant filter to a SELECT. Use on any org-scoped model."""
    return stmt.where(model.org_id == org_id)


def require_org(org_id: str | None) -> str:
    """Guard: a request must resolve to a tenant before touching org data."""
    if not org_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="No organization context")
    return org_id


async def allow_ca_evidence_delete(db) -> None:
    """Arm the transaction-scoped escape hatch that lets the ca_evidence
    append-only trigger permit deletion — required ONLY for organization
    offboarding (the CASCADE would otherwise be blocked). Call inside the same
    transaction that deletes the organization, immediately before the delete.
    Scope is SET LOCAL, so it reverts at commit/rollback automatically."""
    from sqlalchemy import text

    await db.execute(text("SET LOCAL cybersentinel.ca_allow_delete = 'on'"))

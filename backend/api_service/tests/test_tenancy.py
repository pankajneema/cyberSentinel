"""Phase 3 — tenancy helper + model wiring tests (no DB)."""

import pytest
from fastapi import HTTPException

from utils.tenancy import require_org


def test_require_org_rejects_missing():
    with pytest.raises(HTTPException) as exc:
        require_org(None)
    assert exc.value.status_code == 403


def test_require_org_returns_value():
    assert require_org("org-123") == "org-123"


def test_asset_model_has_org_id_and_non_destructive_fk():
    from models.asset_models import Asset

    cols = Asset.__table__.c

    # Tenant ownership is enforced via org_id (CASCADE to the org).
    assert "org_id" in cols
    org_fk = next(iter(cols["org_id"].foreign_keys))
    assert org_fk.ondelete == "CASCADE"

    # user_id is the Supabase `sub` (identity lives in Supabase, not a local users
    # table), so it is intentionally NOT a foreign key and must be nullable — this
    # guarantees removing a user can never cascade-delete the org's assets.
    assert "user_id" in cols
    assert len(cols["user_id"].foreign_keys) == 0
    assert cols["user_id"].nullable is True


def test_asm_discovery_has_org_scope():
    from models.asm_models import AsmDiscovery

    assert "org_id" in AsmDiscovery.__table__.c

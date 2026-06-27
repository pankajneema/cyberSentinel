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
    assert "org_id" in cols
    # user_id must NOT cascade-delete the org's assets when a user is removed.
    user_fk = next(iter(cols["user_id"].foreign_keys))
    assert user_fk.ondelete == "SET NULL"


def test_asm_discovery_has_org_scope():
    from models.asm_models import AsmDiscovery

    assert "org_id" in AsmDiscovery.__table__.c

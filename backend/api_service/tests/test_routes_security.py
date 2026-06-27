"""Security: the dead legacy routes (incl. the users IDOR) must NOT be mounted,
and the real Supabase/org routes MUST be present."""

import importlib


def _paths():
    main = importlib.import_module("main")
    return {getattr(r, "path", "") for r in main.app.routes}


def test_idor_and_legacy_routes_removed():
    paths = _paths()
    # The cross-tenant IDOR surface (audit C-2) must be gone.
    assert not any(p.startswith("/api/v1/users") for p in paths), "users router still mounted (IDOR!)"
    assert not any(p.startswith("/api/v1/team") for p in paths), "legacy team router still mounted"
    assert not any(p.startswith("/api/v1/accounts") for p in paths), "legacy accounts router still mounted"
    assert "/api/v1/auth/login" not in paths, "legacy auth login still mounted"


def test_real_identity_routes_present():
    paths = _paths()
    assert "/api/v1/auth/me" in paths
    assert "/api/v1/orgs/me/members" in paths
    assert "/api/v1/orgs/invites" in paths
    assert "/api/v1/assets" in paths

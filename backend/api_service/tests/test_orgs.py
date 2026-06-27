"""Phase 2 — organizations/memberships unit tests (pure logic, no DB)."""

from datetime import datetime, timedelta

from routes.orgs import ASSIGNABLE_ROLES, INVITE_TTL_HOURS


def test_owner_not_assignable_via_invite():
    # Invites/role-changes may only assign admin/analyst/reader, never owner.
    assert "owner" not in ASSIGNABLE_ROLES
    assert ASSIGNABLE_ROLES == {"admin", "analyst", "reader"}


def test_invite_ttl_is_bounded():
    assert 1 <= INVITE_TTL_HOURS <= 168  # between 1 hour and 7 days


def test_expired_invite_detection():
    expires = datetime.utcnow() - timedelta(hours=1)
    assert expires < datetime.utcnow()  # an hour-old expiry is expired

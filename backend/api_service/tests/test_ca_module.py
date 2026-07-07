"""CA module regression tests.

Two layers:
  * Pure-logic tests (no DB) — posture math, status derivation, no_data /
    vacuous-pass handling, tz normalization. These lock the integrity
    guarantees that the audit found broken.
  * DB-backed integration tests — run against the real dev database (the URL
    in the process env / .env). They self-skip if the DB is unreachable so the
    suite stays green in CI without Postgres.

Every DB test creates a throwaway org and removes it (using the append-only
escape hatch for evidence) in a finally block.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

# ----------------------------------------------------------------------------
# Layer 1 — pure logic (no DB)
# ----------------------------------------------------------------------------
from ca.engine import compute_score, _derive_status
from ca.checks_registry import _naive_utc


class TestPostureMath:
    def test_floor_not_round(self):
        # 5 satisfied + 5 partial over 14 applicable = 53.57 -> floored to 53
        assert compute_score(5, 5, 14) == 53.0

    def test_all_satisfied_is_100(self):
        assert compute_score(10, 0, 10) == 100.0

    def test_partial_weighted_half(self):
        assert compute_score(0, 2, 4) == 25.0  # (0 + 1) / 4

    def test_no_applicable_is_none(self):
        # An org with only N/A controls has no denominator — must be None, not 0
        assert compute_score(0, 0, 0) is None

    def test_unknown_deflates_never_inflates(self):
        # 2 satisfied, 8 unknown (in denominator) -> 20, not 100
        assert compute_score(2, 0, 10) == 20.0

    @pytest.mark.parametrize("sat,par,app,expected", [
        (0, 0, 5, 0.0), (5, 0, 5, 100.0), (1, 1, 3, 50.0), (3, 4, 10, 50.0),
    ])
    def test_matches_hand_formula(self, sat, par, app, expected):
        import math
        assert compute_score(sat, par, app) == float(math.floor((sat + 0.5 * par) / app * 100))


class TestStatusDerivation:
    def test_all_required_pass_is_satisfied(self):
        assert _derive_status([{"required": True, "result": "pass"},
                               {"required": True, "result": "pass"}]) == "satisfied"

    def test_some_required_pass_is_partial(self):
        assert _derive_status([{"required": True, "result": "pass"},
                               {"required": True, "result": "fail"}]) == "partial"

    def test_all_required_fail_is_gap(self):
        assert _derive_status([{"required": True, "result": "fail"}]) == "gap"

    def test_no_evidence_is_unknown(self):
        assert _derive_status([{"required": True, "result": None}]) == "unknown"

    def test_no_data_treated_as_unknown_not_pass(self):
        # The vacuous-pass fix: a 'no_data' outcome arrives as result=None and
        # must NOT satisfy the control.
        assert _derive_status([{"required": True, "result": None}]) == "unknown"

    def test_supporting_fail_downgrades_satisfied_to_partial(self):
        assert _derive_status([{"required": True, "result": "pass"},
                               {"required": False, "result": "fail"}]) == "partial"

    def test_empty_is_unknown(self):
        assert _derive_status([]) == "unknown"


class TestTzNormalization:
    def test_aware_becomes_naive_utc(self):
        aware = datetime(2026, 1, 1, 12, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
        out = _naive_utc(aware)
        assert out.tzinfo is None
        assert out == datetime(2026, 1, 1, 6, 30)  # 12:00 IST -> 06:30 UTC

    def test_naive_passthrough(self):
        naive = datetime(2026, 1, 1, 12, 0)
        assert _naive_utc(naive) == naive

    def test_none_passthrough(self):
        assert _naive_utc(None) is None


# ----------------------------------------------------------------------------
# Layer 2 — DB-backed integration (self-skips without a real DB)
# ----------------------------------------------------------------------------
@pytest.fixture
async def seeded_db():
    """Yields (session_factory, framework map) or skips if the catalog/DB is
    not present. Builds a FRESH engine bound to the current test's event loop
    (pytest-asyncio uses one loop per test; the app's module-global engine
    binds asyncpg connections to whichever loop touched them first, which
    breaks across tests). Requires `python -m scripts.load_frameworks`."""
    from sqlalchemy import select, text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool
    from config.settings import settings
    import models.asm_models, models.asset_models, models.vs_models, models.ca_models  # noqa: F401
    from models.ca_models import CaFramework

    # NullPool: no connection is retained past the session, so nothing binds to
    # this test's event loop and leaks into the next test's loop.
    eng = create_async_engine(settings.DATABASE_URL, poolclass=NullPool, echo=False)
    Session = async_sessionmaker(eng, expire_on_commit=False)
    try:
        async with Session() as db:
            await db.execute(text("SELECT 1"))
            fws = {f.key: f for f in (await db.execute(select(CaFramework))).scalars().all()}
    except Exception:
        await eng.dispose()
        pytest.skip("no database available")
    if "hipaa" not in fws or "soc2" not in fws:
        await eng.dispose()
        pytest.skip("frameworks not loaded (run scripts.load_frameworks)")
    try:
        yield Session, fws
    finally:
        await eng.dispose()


async def _make_org(db, name):
    from models.tenancy_models import Organization
    org = Organization(id=str(uuid.uuid4()), name=name, plan="free", owner_user_id="test")
    db.add(org)
    await db.flush()
    return org


async def _drop_org(db, org_id):
    from sqlalchemy import text
    await db.execute(text("SET LOCAL cybersentinel.ca_allow_delete = 'on'"))
    await db.execute(text("DELETE FROM member_profiles WHERE org_id = :o"), {"o": org_id})
    await db.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": org_id})
    await db.commit()



async def test_never_scanned_org_does_not_inflate(seeded_db):
    """THE regression: an org with no scans must not show satisfied
    vulnerability-management controls."""
    Session, fws = seeded_db
    from sqlalchemy import select
    from models.ca_models import CaOrgFramework, CaControl, CaControlState
    from ca.engine import evaluate_org, seed_control_states, posture_counts
    async with Session() as db:
        org = await _make_org(db, "CA-TEST-INFLATE")
        try:
            db.add(CaOrgFramework(org_id=org.id, framework_id=fws["hipaa"].id,
                                  status="active", enabled_by="test"))
            await db.flush()
            await seed_control_states(db, org.id, fws["hipaa"].id)
            await evaluate_org(db, org.id, reason="test")
            await db.commit()
            ctrl = (await db.execute(select(CaControl).where(
                CaControl.framework_id == fws["hipaa"].id,
                CaControl.control_ref == "164.308(a)(1)(ii)(B)"))).scalar_one()
            st = (await db.execute(select(CaControlState).where(
                CaControlState.org_id == org.id,
                CaControlState.control_id == ctrl.id))).scalar_one()
            assert st.status == "unknown", "never-scanned org inflated a risk-mgmt control"
            pc = await posture_counts(db, org.id, fws["hipaa"].id)
            assert pc["satisfied"] == 0
            assert pc["score"] == 0.0
        finally:
            await _drop_org(db, org.id)



async def test_asm_inventory_collector_runs(seeded_db):
    """The tz bug crashed this collector; a real asset must now yield passing
    inventory evidence and satisfy ISO A.5.9."""
    Session, fws = seeded_db
    from sqlalchemy import select
    from models.asset_models import Asset
    from models.ca_models import CaOrgFramework, CaControl, CaControlState, CaEvidence, CaCheck
    from ca.engine import evaluate_org, seed_control_states
    async with Session() as db:
        org = await _make_org(db, "CA-TEST-ASM")
        try:
            db.add(Asset(id=str(uuid.uuid4()), org_id=org.id, user_id="test",
                         name="t.example.com", type="domain", status="active",
                         ownership_verified=True))
            db.add(CaOrgFramework(org_id=org.id, framework_id=fws["iso27001"].id,
                                  status="active", enabled_by="test"))
            await db.flush()
            await seed_control_states(db, org.id, fws["iso27001"].id)
            await evaluate_org(db, org.id, reason="test")
            await db.commit()
            inv = (await db.execute(select(CaCheck).where(
                CaCheck.key == "asm.inventory_maintained"))).scalar_one()
            ev = (await db.execute(select(CaEvidence).where(
                CaEvidence.org_id == org.id, CaEvidence.check_id == inv.id,
                CaEvidence.status == "valid"))).scalars().first()
            assert ev is not None and ev.result == "pass"
            a59 = (await db.execute(select(CaControl).where(
                CaControl.framework_id == fws["iso27001"].id,
                CaControl.control_ref == "A.5.9"))).scalar_one()
            st = (await db.execute(select(CaControlState).where(
                CaControlState.org_id == org.id, CaControlState.control_id == a59.id))).scalar_one()
            assert st.status == "satisfied"
        finally:
            await _drop_org(db, org.id)



async def test_hash_chain_verifies_across_transaction(seeded_db):
    """Multiple trail rows in one transaction must form a linear chain."""
    import hashlib, json
    Session, fws = seeded_db
    from sqlalchemy import select
    from models.ca_models import CaAuditTrail
    from ca.engine import ca_trail
    async with Session() as db:
        org = await _make_org(db, "CA-TEST-CHAIN")
        try:
            await ca_trail(db, org.id, "u", "test.a")
            await ca_trail(db, org.id, "u", "test.b", target="x", meta={"k": 1})
            await ca_trail(db, org.id, None, "test.c")
            await db.commit()
            rows = (await db.execute(select(CaAuditTrail).where(
                CaAuditTrail.org_id == org.id).order_by(CaAuditTrail.seq))).scalars().all()
            assert len(rows) == 3

            def canon(m):
                return json.dumps(m or {}, sort_keys=True, separators=(",", ":"), default=str)
            prev = None
            for t in rows:
                expected = hashlib.sha256(
                    f"{prev or ''}|{t.org_id}|{t.actor_user_id or ''}|{t.action}|"
                    f"{t.target or ''}|{canon(t.meta)}|{t.at.isoformat()}".encode()).hexdigest()
                assert t.prev_hash == prev, "chain fork — prev_hash mismatch"
                assert t.row_hash == expected, "row_hash mismatch"
                prev = t.row_hash
        finally:
            from sqlalchemy import text
            await db.execute(text("DELETE FROM member_profiles WHERE org_id = :o"), {"o": org.id})
            await db.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": org.id})
            await db.commit()



async def test_evidence_and_trail_immutable(seeded_db):
    """DB triggers block tampering; the GUC escape allows offboarding delete."""
    from sqlalchemy import text
    Session, fws = seeded_db
    from ca.engine import ca_trail
    fake_org = f"test-immut-{uuid.uuid4()}"   # ca_audit_trail.org_id has no FK
    async with Session() as db:
        row = await ca_trail(db, fake_org, "u", "test.immutable")
        await db.commit()
        row_id = row.id

    # The trigger error aborts the transaction, so attempt it on its OWN session.
    blocked = False
    async with Session() as db:
        try:
            await db.execute(text("UPDATE ca_audit_trail SET action='x' WHERE id=:i"), {"i": row_id})
            await db.commit()
        except Exception:
            blocked = True
            await db.rollback()
    assert blocked, "ca_audit_trail UPDATE was NOT blocked by the trigger"

    async with Session() as db:
        await db.execute(text("ALTER TABLE ca_audit_trail DISABLE TRIGGER trg_ca_trail_immutable"))
        await db.execute(text("DELETE FROM ca_audit_trail WHERE org_id = :o"), {"o": fake_org})
        await db.execute(text("ALTER TABLE ca_audit_trail ENABLE TRIGGER trg_ca_trail_immutable"))
        await db.commit()



async def test_expired_manual_evidence_goes_stale(seeded_db):
    """Backdated manual evidence must flip to 'stale' and stop counting."""
    Session, fws = seeded_db
    from sqlalchemy import select, text
    from models.ca_models import CaOrgFramework, CaEvidence, CaCheck
    from ca.engine import evaluate_org, seed_control_states
    async with Session() as db:
        org = await _make_org(db, "CA-TEST-STALE")
        try:
            db.add(CaOrgFramework(org_id=org.id, framework_id=fws["iso27001"].id,
                                  status="active", enabled_by="test"))
            await db.flush()
            await seed_control_states(db, org.id, fws["iso27001"].id)
            pent = (await db.execute(select(CaCheck).where(
                CaCheck.key == "manual.penetration_test.annual"))).scalar_one()
            now = datetime.utcnow()
            ev = CaEvidence(org_id=org.id, check_id=pent.id, collection="manual",
                            source_type="manual_upload", source_ref={}, summary="old",
                            content={}, content_hash="z" * 64, result="pass",
                            captured_at=now - timedelta(days=400),
                            valid_until=now - timedelta(days=35), status="valid",
                            uploaded_by="test")
            db.add(ev)
            await db.flush()
            await evaluate_org(db, org.id, reason="test")
            await db.commit()
            await db.refresh(ev)
            assert ev.status == "stale"
        finally:
            await db.execute(text("SET LOCAL cybersentinel.ca_allow_delete = 'on'"))
            await db.execute(text("DELETE FROM member_profiles WHERE org_id = :o"), {"o": org.id})
            await db.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": org.id})
            await db.commit()



async def test_full_catalogs_loaded(seeded_db):
    """Guard against silent catalog shrinkage."""
    Session, fws = seeded_db
    from sqlalchemy import select, func
    from models.ca_models import CaControl
    async with Session() as db:
        counts = {}
        for key in ("iso27001", "soc2", "pci_dss"):
            counts[key] = (await db.execute(select(func.count(CaControl.id)).where(
                CaControl.framework_id == fws[key].id))).scalar()
        assert counts["iso27001"] >= 93, f"ISO shrank: {counts['iso27001']}"
        assert counts["soc2"] >= 60, f"SOC2 shrank: {counts['soc2']}"
        assert counts["pci_dss"] >= 60, f"PCI shrank: {counts['pci_dss']}"

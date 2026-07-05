"""Idempotent framework/check/policy-template loader.

Usage (from backend/api_service):
    python -m scripts.load_frameworks            # load everything in data/frameworks + templates
    python -m scripts.load_frameworks soc2       # load checks + one framework by key

Frameworks are DATA, not code: this upserts on (key, version) for frameworks,
(framework_id, control_ref) for controls, check `key` for checks, and
(control_id, check_id) for mappings. Every automated check's logic_key is
validated against ca.checks_registry.REGISTRY — unknown keys fail the load so
a control can never silently map to a dead check.
"""

import asyncio
import hashlib
import json
import sys
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.database import AsyncSessionLocal, init_db  # noqa: E402
import models.tenancy_models  # noqa: F401,E402  (FK targets must be registered)
from models.ca_models import (  # noqa: E402
    CaCheck, CaControl, CaControlCheckMap, CaFramework, CaPolicy, CaPolicyVersion,
)
from ca.checks_registry import REGISTRY  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FRAMEWORKS_DIR = DATA_DIR / "frameworks"


def _sha256(data) -> str:
    if isinstance(data, (dict, list)):
        data = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


async def load_checks(db) -> dict:
    """Upsert the canonical check catalog. Returns key -> CaCheck."""
    payload = json.loads((FRAMEWORKS_DIR / "checks.json").read_text())
    by_key: dict[str, CaCheck] = {}
    for spec in payload["checks"]:
        if spec["collection"] == "automated":
            if spec.get("logic_key") not in REGISTRY:
                raise SystemExit(
                    f"checks.json: automated check '{spec['key']}' has unknown "
                    f"logic_key '{spec.get('logic_key')}' — not in ca.checks_registry.REGISTRY"
                )
        row = (await db.execute(select(CaCheck).where(CaCheck.key == spec["key"]))).scalar_one_or_none()
        if row is None:
            row = CaCheck(key=spec["key"])
            db.add(row)
        row.name = spec["name"]
        row.description = spec.get("description")
        row.collection = spec["collection"]
        row.logic_key = spec.get("logic_key")
        row.logic_params = spec.get("logic_params")
        row.source_type = spec.get("source_type")
        row.freshness_days = spec.get("freshness_days", 90)
        row.weight = spec.get("weight", 1)
        by_key[row.key] = row
    await db.flush()
    return by_key


async def load_framework(db, path: Path, checks_by_key: dict) -> tuple[str, int]:
    spec = json.loads(path.read_text())
    fw = (
        await db.execute(
            select(CaFramework).where(CaFramework.key == spec["key"], CaFramework.version == spec["version"])
        )
    ).scalar_one_or_none()
    if fw is None:
        fw = CaFramework(key=spec["key"], version=spec["version"], name=spec["name"])
        db.add(fw)
    fw.name = spec["name"]
    fw.authority = spec.get("authority")
    fw.region = spec.get("region")
    fw.description = spec.get("description")
    fw.is_reference = bool(spec.get("is_reference", False))
    fw.source_checksum = _sha256(path.read_text())
    await db.flush()

    n = 0
    for c in spec["controls"]:
        ctrl = (
            await db.execute(
                select(CaControl).where(
                    CaControl.framework_id == fw.id, CaControl.control_ref == c["control_ref"]
                )
            )
        ).scalar_one_or_none()
        if ctrl is None:
            ctrl = CaControl(framework_id=fw.id, control_ref=c["control_ref"], title=c["title"])
            db.add(ctrl)
        ctrl.title = c["title"]
        ctrl.description = c.get("description")
        ctrl.category = c.get("category")
        ctrl.criticality = c.get("criticality", "medium")
        ctrl.control_type = c.get("control_type", "technical")
        ctrl.evidence_guidance = c.get("evidence_guidance")
        await db.flush()
        n += 1

        for m in c.get("checks", []):
            check = checks_by_key.get(m["key"])
            if check is None:
                raise SystemExit(
                    f"{path.name}: control {c['control_ref']} maps unknown check key '{m['key']}'"
                )
            link = (
                await db.execute(
                    select(CaControlCheckMap).where(
                        CaControlCheckMap.control_id == ctrl.id,
                        CaControlCheckMap.check_id == check.id,
                    )
                )
            ).scalar_one_or_none()
            if link is None:
                link = CaControlCheckMap(control_id=ctrl.id, check_id=check.id)
                db.add(link)
            link.required = bool(m.get("required", True))
            link.rationale = m.get("rationale")
    return spec["key"], n


async def load_policy_templates(db) -> int:
    payload = json.loads((DATA_DIR / "policy_templates.json").read_text())
    n = 0
    for t in payload["templates"]:
        pol = (
            await db.execute(
                select(CaPolicy).where(
                    CaPolicy.org_id.is_(None), CaPolicy.key == t["key"], CaPolicy.status == "template"
                )
            )
        ).scalar_one_or_none()
        if pol is None:
            pol = CaPolicy(org_id=None, key=t["key"], status="template", title=t["title"])
            db.add(pol)
        pol.title = t["title"]
        pol.description = t.get("description")
        pol.review_frequency_days = t.get("review_frequency_days", 365)
        await db.flush()

        body = t["body_md"]
        digest = _sha256(body)
        ver = (
            await db.execute(
                select(CaPolicyVersion)
                .where(CaPolicyVersion.policy_id == pol.id)
                .order_by(CaPolicyVersion.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if ver is None or ver.sha256 != digest:
            ver = CaPolicyVersion(
                policy_id=pol.id,
                version=(ver.version + 1) if ver else 1,
                body_md=body,
                sha256=digest,
                published_by=None,
            )
            db.add(ver)
            await db.flush()
        pol.current_version_id = ver.id
        n += 1
    return n


async def main() -> None:
    only_key = sys.argv[1] if len(sys.argv) > 1 else None
    await init_db()
    async with AsyncSessionLocal() as db:
        checks = await load_checks(db)
        print(f"checks: {len(checks)} upserted")
        for path in sorted(FRAMEWORKS_DIR.glob("*.json")):
            if path.name == "checks.json":
                continue
            spec_key = json.loads(path.read_text()).get("key")
            if only_key and spec_key != only_key:
                continue
            key, n = await load_framework(db, path, checks)
            print(f"framework {key}: {n} controls upserted")
        if not only_key:
            n = await load_policy_templates(db)
            print(f"policy templates: {n} upserted")
        await db.commit()
    print("done")


if __name__ == "__main__":
    asyncio.run(main())

"""
CVE intelligence feed sync — populates `vs_cve_metadata` from authoritative,
REAL sources. Nothing here is fabricated; if a feed is unreachable the sync
logs and skips (leaves existing data intact) rather than inventing values.

Sources:
  - CISA KEV catalog (JSON)            -> kev flag, date added, due date
  - FIRST EPSS daily scores (CSV.gz)   -> epss_score, epss_percentile
  - NVD 2.0 API (incremental by mod)   -> CVSS v3.1/v4.0 vectors+scores, CWE, CPE

All upserts are ON CONFLICT DO UPDATE keyed on cve_id, so a re-sync refreshes in
place. Designed to run from the scheduler daily.

NOTE: NVD enforces rate limits; set NVD_API_KEY for higher throughput. All calls
are network-bound and cannot be exercised in an offline environment — the parsing
and upsert paths are unit-testable with fixture payloads.
"""
from __future__ import annotations

import csv
import gzip
import io
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from models.vs_models import VsCveMetadata

logger = logging.getLogger("cybersentinel.cve_feeds")

KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
EPSS_URL = "https://epss.cyentia.com/epss_scores-current.csv.gz"
NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"

_TIMEOUT = httpx.Timeout(60.0, connect=15.0)


def _parse_dt(v: Any) -> datetime | None:
    if not v:
        return None
    s = str(v).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(str(v), fmt)
            except ValueError:
                continue
    return None


async def _upsert(db, rows: list[dict]) -> int:
    """Upsert a batch into vs_cve_metadata (ON CONFLICT DO UPDATE by cve_id).
    Only non-null incoming columns overwrite, so KEV/EPSS/NVD syncs compose
    without clobbering each other's fields."""
    if not rows:
        return 0
    # Naive UTC: vs_cve_metadata timestamps are TIMESTAMP WITHOUT TIME ZONE, and
    # asyncpg rejects a tz-aware value for those columns.
    now = datetime.utcnow()
    for r in rows:
        r["last_synced_at"] = now
    stmt = pg_insert(VsCveMetadata).values(rows)
    update_cols = {}
    for col in rows[0].keys():
        if col == "cve_id":
            continue
        # COALESCE(excluded.col, existing.col) — don't overwrite a real value with NULL.
        update_cols[col] = getattr(
            __import__("sqlalchemy").func, "coalesce"
        )(getattr(stmt.excluded, col), getattr(VsCveMetadata, col))
    stmt = stmt.on_conflict_do_update(index_elements=["cve_id"], set_=update_cols)
    await db.execute(stmt)
    await db.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# CISA KEV
# ---------------------------------------------------------------------------
async def sync_kev(db) -> int:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(KEV_URL)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:  # noqa: BLE001
        logger.warning("KEV sync failed: %s", e)
        return 0
    rows = []
    for v in data.get("vulnerabilities", []):
        cid = v.get("cveID")
        if not cid:
            continue
        rows.append({
            "cve_id": cid,
            "kev": True,
            "kev_date_added": _parse_dt(v.get("dateAdded")),
            "kev_due_date": _parse_dt(v.get("dueDate")),
        })
    n = await _upsert(db, rows)
    logger.info("KEV sync: upserted %d known-exploited CVEs", n)
    return n


# ---------------------------------------------------------------------------
# FIRST EPSS
# ---------------------------------------------------------------------------
async def sync_epss(db, batch_size: int = 5000) -> int:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(EPSS_URL)
            resp.raise_for_status()
            raw = gzip.decompress(resp.content).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        logger.warning("EPSS sync failed: %s", e)
        return 0
    # File has a comment header line beginning with '#', then a CSV header.
    lines = [ln for ln in raw.splitlines() if ln and not ln.startswith("#")]
    reader = csv.DictReader(lines)
    total, batch = 0, []
    for row in reader:
        cid = row.get("cve")
        if not cid:
            continue
        try:
            batch.append({
                "cve_id": cid,
                "epss_score": float(row.get("epss") or 0.0),
                "epss_percentile": float(row.get("percentile") or 0.0),
            })
        except ValueError:
            continue
        if len(batch) >= batch_size:
            total += await _upsert(db, batch)
            batch = []
    total += await _upsert(db, batch)
    logger.info("EPSS sync: upserted %d CVE scores", total)
    return total


# ---------------------------------------------------------------------------
# NVD 2.0 (incremental by lastModified window)
# ---------------------------------------------------------------------------
def _extract_nvd(cve: dict) -> dict | None:
    cid = cve.get("id")
    if not cid:
        return None
    metrics = cve.get("metrics", {}) or {}
    out: dict[str, Any] = {"cve_id": cid}

    def _first(key):
        arr = metrics.get(key) or []
        return arr[0].get("cvssData", {}) if arr else {}

    v31 = _first("cvssMetricV31")
    if v31:
        out["cvss_v31_score"] = v31.get("baseScore")
        out["cvss_v31_vector"] = v31.get("vectorString")
    v40 = _first("cvssMetricV40")
    if v40:
        out["cvss_v40_score"] = v40.get("baseScore")
        out["cvss_v40_vector"] = v40.get("vectorString")

    cwes = []
    for w in cve.get("weaknesses", []) or []:
        for d in w.get("description", []) or []:
            if d.get("value") and d["value"].startswith("CWE-"):
                cwes.append(d["value"])
    if cwes:
        out["cwe_ids"] = sorted(set(cwes))

    cpes = []
    for cfg in cve.get("configurations", []) or []:
        for node in cfg.get("nodes", []) or []:
            for m in node.get("cpeMatch", []) or []:
                if m.get("criteria"):
                    cpes.append({
                        "cpe": m["criteria"],
                        "vuln_start_incl": m.get("versionStartIncluding"),
                        "vuln_end_excl": m.get("versionEndExcluding"),
                    })
    if cpes:
        out["affected_versions"] = cpes

    refs = [r.get("url") for r in cve.get("references", []) or [] if r.get("url")]
    if refs:
        out["references"] = refs
    out["published_at"] = _parse_dt(cve.get("published"))
    out["modified_at"] = _parse_dt(cve.get("lastModified"))
    return out


async def sync_nvd_recent(db, days: int = 2) -> int:
    """Pull CVEs modified in the last `days` days (incremental). Paginates the
    NVD 2.0 API respecting its 2000-result page cap."""
    api_key = os.getenv("NVD_API_KEY")
    headers = {"apiKey": api_key} if api_key else {}
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    params_base = {
        "lastModStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000"),
        "lastModEndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000"),
        "resultsPerPage": 2000,
    }
    total, start_index = 0, 0
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=headers) as client:
            while True:
                params = {**params_base, "startIndex": start_index}
                resp = await client.get(NVD_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                rows = []
                for item in data.get("vulnerabilities", []) or []:
                    parsed = _extract_nvd(item.get("cve", {}))
                    if parsed:
                        rows.append(parsed)
                total += await _upsert(db, rows)
                start_index += data.get("resultsPerPage", 0) or 0
                if start_index >= (data.get("totalResults", 0) or 0):
                    break
    except Exception as e:  # noqa: BLE001
        logger.warning("NVD sync failed (synced %d before error): %s", total, e)
    logger.info("NVD sync: upserted %d CVE records", total)
    return total


async def sync_all(db) -> dict:
    """Run all three feeds. Order matters only for logging; upserts compose."""
    return {
        "kev": await sync_kev(db),
        "epss": await sync_epss(db),
        "nvd": await sync_nvd_recent(db),
    }

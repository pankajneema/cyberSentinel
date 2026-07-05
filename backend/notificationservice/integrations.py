"""
Outbound integration senders for VS (vulnerability/exposure) findings.

Two real integrations, both async and best-effort:

  * Jira ticketing   -> create_jira_issue()
  * SIEM / webhook   -> forward_to_siem()  (JSON or ArcSight CEF)

Contract, strictly enforced:
  * NO fabricated success. A sender returns None/False (and logs) when it is
    unconfigured or when the remote call errors. It never claims to have created
    a ticket it did not create.
  * NEVER log secrets/tokens. Credentials are accepted as arguments and used only
    to build the request; they are never written to a log line.
  * Configuration is passed in by the caller (from settings/env). These functions
    do not read the environment themselves, so they stay pure-ish and testable.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0, connect=4.0)

# Severity (finding) -> Jira priority name. These are the default Jira priority
# scheme names; a project with a custom scheme may need remapping by the caller.
SEVERITY_TO_JIRA_PRIORITY: dict[str, str] = {
    "critical": "Highest",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "info": "Lowest",
}

# Severity -> CEF severity number (0-10) per the ArcSight CEF spec, where
# 0-3 = Low, 4-6 = Medium, 7-8 = High, 9-10 = Very-High.
SEVERITY_TO_CEF_NUMBER: dict[str, int] = {
    "critical": 10,
    "high": 8,
    "medium": 5,
    "low": 3,
    "info": 0,
}


def _severity(finding: dict) -> str:
    return str(finding.get("severity") or "info").strip().lower()


def _title(finding: dict) -> str:
    return str(
        finding.get("title")
        or finding.get("name")
        or finding.get("template_id")
        or finding.get("plugin_id")
        or "Untitled finding"
    ).strip()


def _plugin_id(finding: dict) -> str:
    return str(
        finding.get("plugin_id")
        or finding.get("pluginId")
        or finding.get("template_id")
        or finding.get("id")
        or "unknown"
    ).strip()


# --------------------------------------------------------------------------- #
# Jira
# --------------------------------------------------------------------------- #
def _build_jira_description(finding: dict) -> str:
    """Human-readable Jira description with the threat-intel context we have."""
    lines: list[str] = []

    desc = finding.get("description") or finding.get("summary")
    if desc:
        lines.append(str(desc).strip())
        lines.append("")

    meta: list[str] = []
    for label, key in (
        ("CVE", "cve"),
        ("CVSS", "cvss"),
        ("EPSS", "epss"),
        ("KEV", "kev"),
    ):
        val = finding.get(key)
        if val is None or val == "":
            continue
        if key == "kev":
            val = "Yes (known exploited)" if val else "No"
        meta.append(f"* {label}: {val}")
    if meta:
        lines.append("h3. Threat intelligence")
        lines.extend(meta)
        lines.append("")

    for label, key in (("Asset", "asset"), ("Host", "host"), ("URL", "url"), ("Port", "port")):
        val = finding.get(key)
        if val:
            lines.append(f"* {label}: {val}")

    evidence = finding.get("evidence") or finding.get("matched_at") or finding.get("proof")
    if evidence:
        lines.append("")
        lines.append("h3. Evidence")
        lines.append("{code}")
        lines.append(str(evidence).strip())
        lines.append("{code}")

    lines.append("")
    lines.append(f"Detected by CyberSentinel VS (plugin: {_plugin_id(finding)}).")
    return "\n".join(lines)


async def create_jira_issue(
    finding: dict,
    *,
    base_url: str,
    project_key: str,
    email: str,
    api_token: str,
) -> Optional[str]:
    """Create a Jira issue for a finding. Returns the issue key on success, else None.

    POSTs to ``{base_url}/rest/api/2/issue`` using HTTP Basic auth (email:api_token).
    Returns None (and logs) if unconfigured or on any error/non-201 response.
    """
    if not (base_url and project_key and email and api_token):
        logger.info("jira: skipped (integration not fully configured)")
        return None
    if not base_url.lower().startswith(("http://", "https://")):
        logger.warning("jira: invalid base_url scheme")
        return None

    sev = _severity(finding)
    summary = f"[{sev.upper()}] {_title(finding)}"
    # Jira caps summary at 255 chars.
    summary = summary[:254]

    payload = {
        "fields": {
            "project": {"key": project_key},
            "summary": summary,
            "description": _build_jira_description(finding),
            "issuetype": {"name": "Bug"},
            "priority": {"name": SEVERITY_TO_JIRA_PRIORITY.get(sev, "Medium")},
        }
    }

    url = base_url.rstrip("/") + "/rest/api/2/issue"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=payload, auth=(email, api_token))
    except Exception as e:  # noqa: BLE001 - best-effort integration
        logger.warning("jira: request failed: %s", e)
        return None

    if resp.status_code == 201:
        try:
            key = resp.json().get("key")
        except Exception:  # noqa: BLE001
            key = None
        if key:
            logger.info("jira: created issue %s", key)
            return str(key)
        logger.warning("jira: 201 but no key in response")
        return None

    # Never fabricate success: anything but 201 is a failure.
    logger.warning("jira: create failed (%s): %s", resp.status_code, resp.text[:300])
    return None


# --------------------------------------------------------------------------- #
# SIEM / generic webhook
# --------------------------------------------------------------------------- #
def _cef_escape(value: Any) -> str:
    """Escape a value for the CEF *extension* fields."""
    s = str(value)
    return s.replace("\\", "\\\\").replace("=", "\\=").replace("\n", " ").replace("\r", " ")


def _cef_escape_header(value: Any) -> str:
    """Escape a value for CEF *header* fields (pipe-delimited)."""
    s = str(value)
    return s.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def build_cef(finding: dict) -> str:
    """Build an ArcSight CEF v0 line from a finding.

    CEF:0|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
    """
    sev = _severity(finding)
    header = "|".join(
        [
            "CEF:0",
            "CyberSentinel",
            "VS",
            "1.0",
            _cef_escape_header(_plugin_id(finding)),
            _cef_escape_header(_title(finding)),
            str(SEVERITY_TO_CEF_NUMBER.get(sev, 0)),
        ]
    )

    ext_parts: list[str] = []
    ext_map = [
        ("cs1", finding.get("cve")),
        ("cs1Label", "CVE" if finding.get("cve") else None),
        ("cs2", finding.get("cvss")),
        ("cs2Label", "CVSS" if finding.get("cvss") not in (None, "") else None),
        ("cs3", finding.get("epss")),
        ("cs3Label", "EPSS" if finding.get("epss") not in (None, "") else None),
        ("dhost", finding.get("host")),
        ("request", finding.get("url")),
        ("dpt", finding.get("port")),
        ("msg", finding.get("description") or finding.get("evidence")),
        ("CyberSentinelSeverity", sev),
    ]
    for key, val in ext_map:
        if val is None or val == "":
            continue
        ext_parts.append(f"{key}={_cef_escape(val)}")

    return header + "|" + " ".join(ext_parts)


async def forward_to_siem(finding: dict, *, webhook_url: str, fmt: str = "json") -> bool:
    """Forward a finding to a SIEM / generic webhook. Returns True on a 2xx response.

    ``fmt='json'`` posts the structured finding; ``fmt='cef'`` posts a CEF line as
    ``text/plain``. Returns False (and logs) if unconfigured or on any error.
    """
    if not webhook_url or not webhook_url.lower().startswith(("http://", "https://")):
        logger.info("siem: skipped (webhook not configured)")
        return False

    fmt = (fmt or "json").strip().lower()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            if fmt == "cef":
                resp = await client.post(
                    webhook_url,
                    content=build_cef(finding).encode("utf-8"),
                    headers={"Content-Type": "text/plain; charset=utf-8"},
                )
            else:
                resp = await client.post(webhook_url, json=finding)
    except Exception as e:  # noqa: BLE001 - best-effort integration
        logger.warning("siem: forward failed: %s", e)
        return False

    if 200 <= resp.status_code < 300:
        return True
    logger.warning("siem: webhook returned %s: %s", resp.status_code, resp.text[:200])
    return False


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #
async def notify_integrations(finding: dict, config: dict) -> dict:
    """Dispatch a finding to whichever integrations are configured.

    ``config`` shape (each key optional)::

        {
          "jira": {"base_url", "project_key", "email", "api_token"},
          "siem": {"webhook_url", "fmt"},
        }

    Returns ``{"jira": <issue-key or None>, "siem": <bool>}`` for the integrations
    that were present. An empty/absent config is an honest no-op: ``{}`` with no
    network call.
    """
    if not config:
        return {}

    result: dict[str, Any] = {}

    jira_cfg = config.get("jira")
    if jira_cfg:
        result["jira"] = await create_jira_issue(
            finding,
            base_url=jira_cfg.get("base_url", ""),
            project_key=jira_cfg.get("project_key", ""),
            email=jira_cfg.get("email", ""),
            api_token=jira_cfg.get("api_token", ""),
        )

    siem_cfg = config.get("siem")
    if siem_cfg:
        result["siem"] = await forward_to_siem(
            finding,
            webhook_url=siem_cfg.get("webhook_url", ""),
            fmt=siem_cfg.get("fmt", "json"),
        )

    return result

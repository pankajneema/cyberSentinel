"""
Notification event taxonomy for CyberSentinel.

Every realtime / notification event flows through `dispatch()` with one of these
`type` values. The `RULE_FOR_EVENT` map ties an event to the ASM-settings
notification-rule toggle that gates outbound channels (email/Slack/Teams). If an
event has no rule, it is always delivered in-app but never gated for channels.
"""
from __future__ import annotations

# --- ASM scan lifecycle ---
SCAN_STARTED = "scan.started"
SCAN_COMPLETED = "scan.completed"
SCAN_FAILED = "scan.failed"
SCAN_STOPPED = "scan.stopped"
SCAN_PAUSED = "scan.paused"
SCAN_RESUMED = "scan.resumed"

# --- findings ---
FINDINGS_NEW = "findings.new"
FINDING_CRITICAL = "finding.critical"
FINDING_HIGH = "finding.high"

# --- team / panel ---
TEAM_MESSAGE = "team.message"

# Maps an event type -> the ASM settings notification-rule key (matching the keys
# the settings UI persists) that must be enabled for the event to be pushed to
# email/Slack/Teams. In-app + websocket delivery is NOT gated by these (the panel
# always reflects reality). Events with no entry here deliver in-app/realtime only
# and are never pushed to noisy outbound channels by default.
RULE_FOR_EVENT: dict[str, str] = {
    SCAN_COMPLETED: "discovery_completed",
    SCAN_FAILED: "discovery_completed",   # a finished-in-failure run rides the same toggle
    FINDING_CRITICAL: "high_exposure",
    FINDING_HIGH: "high_exposure",
    FINDINGS_NEW: "medium_exposure",
}

# Severity ordering for coloring / thresholds.
SEVERITY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

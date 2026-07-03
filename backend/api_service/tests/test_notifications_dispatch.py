"""Unit tests for notification channel gating and recipient parsing.

These cover the pure logic (no DB / no network) so the settings-driven fan-out
behaves as intended: channel delivery is gated by the ASM notification toggles,
and events with no mapped rule never spam email/Slack.
"""
import sys
import pathlib

# notificationservice lives under backend/, one level above api_service.
sys.path.append(str(pathlib.Path(__file__).resolve().parents[2]))

from notificationservice import events as ev
from notificationservice.dispatcher import _rule_enabled
from notificationservice.channels import _clean


def test_unmapped_events_never_push_channels():
    # scan.started / stopped have no rule -> must not push to email/slack.
    assert _rule_enabled({"anything": True}, ev.SCAN_STARTED) is False
    assert _rule_enabled({}, ev.SCAN_STOPPED) is False


def test_mapped_event_respects_toggle():
    assert _rule_enabled({"discovery_completed": True}, ev.SCAN_COMPLETED) is True
    assert _rule_enabled({"discovery_completed": False}, ev.SCAN_COMPLETED) is False
    # Absent toggle defaults to enabled for a mapped event.
    assert _rule_enabled({}, ev.SCAN_COMPLETED) is True


def test_findings_ride_exposure_rules():
    assert _rule_enabled({"high_exposure": True}, ev.FINDING_CRITICAL) is True
    assert _rule_enabled({"high_exposure": False}, ev.FINDING_HIGH) is False
    assert _rule_enabled({"medium_exposure": True}, ev.FINDINGS_NEW) is True


def test_email_recipient_parsing():
    assert _clean(["a@x.com, b@y.com; c@z.com"]) == ["a@x.com", "b@y.com", "c@z.com"]
    assert _clean(["a@x.com", "a@x.com"]) == ["a@x.com"]  # dedup
    assert _clean(["not-an-email", ""]) == []
    assert _clean(None) == []

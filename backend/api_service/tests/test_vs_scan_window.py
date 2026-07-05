"""Scan-window enforcement logic (pure)."""
from datetime import datetime
from utils.scheduler import _in_scan_window

def _at(h, m=0):  # a UTC datetime at HH:MM
    return datetime(2026, 7, 5, h, m)

def test_no_window_always_allowed():
    assert _in_scan_window({}, _at(3)) is True
    assert _in_scan_window({"start": "09:00"}, _at(3)) is True   # missing end

def test_normal_window():
    w = {"start": "09:00", "end": "17:00", "tz": "UTC"}
    assert _in_scan_window(w, _at(12)) is True
    assert _in_scan_window(w, _at(8)) is False
    assert _in_scan_window(w, _at(18)) is False

def test_crosses_midnight():
    w = {"start": "22:00", "end": "06:00", "tz": "UTC"}
    assert _in_scan_window(w, _at(23)) is True
    assert _in_scan_window(w, _at(2)) is True
    assert _in_scan_window(w, _at(12)) is False

def test_bad_tz_does_not_block():
    assert _in_scan_window({"start": "09:00", "end": "17:00", "tz": "Not/AZone"}, _at(3)) is True

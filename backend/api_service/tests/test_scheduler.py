"""Unit tests for the ASM scheduler's scheduling math (no DB / no queue).

Covers interval parsing, CRON next-run, and the combined compute_next_run used by
the create/run/resume routes and the scheduler tick.
"""

from datetime import datetime, timedelta

import pytest

from utils.schedule_math import parse_interval, next_cron, compute_next_run, _HAS_CRONITER


BASE = datetime(2026, 7, 3, 12, 0, 0)


@pytest.mark.parametrize("value,expected", [
    ("5h", timedelta(hours=5)),
    ("24h", timedelta(hours=24)),
    ("168h", timedelta(hours=168)),
    ("720h", timedelta(hours=720)),
    ("30m", timedelta(minutes=30)),
    ("1d", timedelta(days=1)),
    (" 2H ", timedelta(hours=2)),
])
def test_parse_interval_valid(value, expected):
    assert parse_interval(value) == expected


@pytest.mark.parametrize("value", [None, "", "0h", "-1h", "abc", "5", "5w", "h"])
def test_parse_interval_invalid(value):
    assert parse_interval(value) is None


def test_compute_next_run_interval():
    assert compute_next_run("INTERVAL", "5h", BASE) == BASE + timedelta(hours=5)


def test_compute_next_run_quick_is_none():
    assert compute_next_run("QUICK", None, BASE) is None


def test_compute_next_run_bad_interval_is_none():
    assert compute_next_run("INTERVAL", "nonsense", BASE) is None


@pytest.mark.skipif(not _HAS_CRONITER, reason="croniter not installed")
def test_next_cron_every_10_min():
    # 12:00 -> next */10 fire is 12:10
    assert next_cron("*/10 * * * *", BASE) == datetime(2026, 7, 3, 12, 10, 0)


@pytest.mark.skipif(not _HAS_CRONITER, reason="croniter not installed")
def test_next_cron_daily_at_midnight():
    assert next_cron("0 0 * * *", BASE) == datetime(2026, 7, 4, 0, 0, 0)


@pytest.mark.skipif(not _HAS_CRONITER, reason="croniter not installed")
def test_next_cron_invalid_expr_is_none():
    assert next_cron("not a cron", BASE) is None


@pytest.mark.skipif(not _HAS_CRONITER, reason="croniter not installed")
def test_compute_next_run_cron():
    assert compute_next_run("CRON", "*/15 * * * *", BASE) == datetime(2026, 7, 3, 12, 15, 0)

"""Sanitizers for scanner-derived free-text before it is persisted.

Scanner tools emit attacker-influenced strings (banners, service versions,
titles, arbitrary JSON blobs). Persisting them verbatim and rendering them in
the dashboard is a stored-XSS vector. Every free-text value that originates
from tool output must be passed through ``clean_str`` / ``clean_deep`` BEFORE
it is written to an ORM object.

The transform is:
  1. strip terminal ANSI color escapes (e.g. ``\x1b[32m``), which scanners
     like sslscan emit inline, and
  2. HTML-escape the remaining text so it cannot break out of an HTML/attribute
     context when rendered.
"""

import html
import re
from typing import Any

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def clean_str(v: Any) -> Any:
    """Strip ANSI escapes and HTML-escape a string; pass non-strings through."""
    if isinstance(v, str):
        return html.escape(_ANSI_RE.sub("", v))
    return v


def clean_deep(o: Any) -> Any:
    """Recursively apply ``clean_str`` to dict values, list items and scalars."""
    if isinstance(o, dict):
        return {k: clean_deep(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean_deep(v) for v in o]
    return clean_str(o)

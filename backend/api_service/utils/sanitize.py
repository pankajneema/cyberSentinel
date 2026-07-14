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


def strip_ansi(v: Any) -> Any:
    """Strip ANSI escapes + surrounding whitespace WITHOUT HTML-escaping.

    Empty/whitespace-only strings (and empty non-string values) become None.
    Used where the cleaned value is parsed further (e.g. certificate dates),
    not persisted as display text.
    """
    if not isinstance(v, str):
        return v if v not in ("", None) else None
    cleaned = _ANSI_RE.sub("", v).strip()
    return cleaned or None


def clean_str_stripped(v: Any) -> Any:
    """ANSI-strip + whitespace-strip + HTML-escape; empty -> None.

    Union of the historical ``clean_str(_clean_ansi(v))`` composition used for
    scanner fields (sslscan protocol/cipher/issuer/subject) that must be NULL
    rather than empty in VARCHAR columns.
    """
    s = strip_ansi(v)
    if isinstance(s, str):
        return html.escape(s)
    return s


def clean_deep_stripped(o: Any) -> Any:
    """Recursive ANSI-strip + whitespace-strip + HTML-escape for JSON detail
    columns. Union of the historical ``clean_deep(_clean_ansi_obj(o))``
    composition: strings are stripped then escaped (empty stays empty),
    non-strings pass through untouched."""
    if isinstance(o, dict):
        return {k: clean_deep_stripped(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean_deep_stripped(v) for v in o]
    if isinstance(o, str):
        return html.escape(_ANSI_RE.sub("", o).strip())
    return o

# Shared lifecycle-transition validation for workflow state machines
# (VS finding lifecycle, CA gap lifecycle). Each domain keeps its own
# transition map and error wording; only the validation mechanics are shared.

from fastapi import HTTPException


def validate_transition(
    transitions: dict, current: str, target: str, *,
    justify_required=frozenset(), justification: str | None = None,
    illegal_detail: str, justify_detail: str,
) -> None:
    """Raise 409 for an illegal transition, 400 for a missing justification.
    Detail strings are supplied by the caller so each module keeps its exact
    API error wording."""
    if target not in transitions.get(current, set()):
        raise HTTPException(409, illegal_detail)
    if target in justify_required and not (justification or "").strip():
        raise HTTPException(400, justify_detail)

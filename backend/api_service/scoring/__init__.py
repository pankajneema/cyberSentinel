"""Defensible exposure scoring for CyberSentinel ASM."""

from .exposure import (
    AssetSignals,
    CveSignal,
    ExposureScore,
    ScoreFactor,
    score_exposure,
    DEFAULT_WEIGHTS,
)

__all__ = [
    "AssetSignals",
    "CveSignal",
    "ExposureScore",
    "ScoreFactor",
    "score_exposure",
    "DEFAULT_WEIGHTS",
]

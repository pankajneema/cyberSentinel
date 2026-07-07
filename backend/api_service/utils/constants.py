# Shared cross-module constants.

# Remediation SLA days by severity/criticality — used by the CA gap engine
# (ca/engine.py) and mirrored by reporting/vs/ingest.py so remediation
# expectations are consistent platform-wide.
SLA_DAYS = {"critical": 7, "high": 15, "medium": 30, "low": 90}

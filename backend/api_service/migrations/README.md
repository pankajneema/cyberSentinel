# Database migrations (Alembic)

Replaces `create_all()` as the schema mechanism (audit M-4). Versioned, reversible.

## Setup
```bash
cd backend/api_service
pip install alembic        # add to requirements.txt
```

## Create the baseline (once, against a dev DB)
```bash
# Autogenerate the first revision from the current models:
alembic revision --autogenerate -m "baseline schema"
# Review the generated file in migrations/versions/ before applying.
alembic upgrade head
```

## Day-to-day
```bash
alembic revision --autogenerate -m "add org_id to assets"
alembic upgrade head      # apply
alembic downgrade -1      # roll back one
```

## Notes
- The DB URL and target metadata come from `config.settings` + `utils.database.Base`
  (see `env.py`) — nothing is hardcoded.
- Once the baseline is in place, **remove the `create_all()` call** from
  `migration.py` / startup so Alembic is the single source of schema truth.
- `versions/` holds the revision files (created by the commands above).

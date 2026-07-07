# Standardization & Simplification Refactor — Report

Companion to [06_canonical_structure.md](06_canonical_structure.md) (the canonical spec). This records
what moved, what was deduplicated, and what was deliberately left alone in the July 2026 refactor.
Behavior was preserved throughout — verified by route-table parity (168/168 identical), the full test
suite, and per-service builds.

## What each module looked like before

| | ASM (oldest) | VS | CA (newest) |
|---|---|---|---|
| Route file | 2,208-line fat routes, all logic inline | 651 lines, mostly thin | 1,400+ lines, thin-ish |
| Domain layer | none | none | `ca/` package (engine, checks_registry) |
| Auth | legacy `auth_utils` dict user | `supabase_auth` CurrentUser | `supabase_auth` CurrentUser |
| Tenancy | member-id helpers `_org_filter`/`_company_user_ids` | `require_org` + `org_id ==` | `require_org` + `org_id ==` |
| Pagination | hand-rolled per endpoint, inconsistent clamps | inline Query dupes | reusable `_page_params` dep |
| Queue publish | envelope dict duplicated 3× | duplicated route + scheduler | n/a |

CA was the cleanest backend shape, VS the cleanest worker/reporting shape, `routes/assets.py` the
documented tenancy reference — the canon is those patterns applied everywhere.

## What changed

**Backend (`api_service`)** — every module now: thin `routes/<module>.py` → `<module>/service.py`
domain package → `models/<module>_models.py` + `schemas/<module>_schema.py`, with scoring in `scoring/`.
- New: `asm/service.py` (queue envelope, child-table list helper, scheduler tick), `vs/service.py`
  (enqueue + scan-window tick), `ca/service.py`; shared `utils/pagination.py`, `utils/ownership.py`
  (replaces 7 private `_owned_*` copies), `utils/lifecycle.py` (VS/CA transition mechanics),
  `utils/constants.py` (`SLA_DAYS`, previously duplicated in `ca/engine.py` and `reporting/vs/ingest.py`).
- `utils/scheduler.py` 652 → 233 lines: a thin loop calling module ticks; `FOR UPDATE SKIP LOCKED`
  claiming and process-local guards preserved. Layering inversions fixed:
  `_gather_asset_signals` → `scoring/asset_signals.py`, `generate_scheduled_report` → `reports_service.py`.
- ASM's 9 near-identical child-table list endpoints collapsed into one parameterized
  `asm/service.list_child_rows` (each endpoint keeps its exact filters/sort whitelist/search columns).
- Auth unified on `utils/supabase_auth` (typed `CurrentUser` + `require_role`); legacy
  `utils/auth_utils.py` deleted. ASM's member-id *filter semantics* unchanged (moved to `asm/service.py`).
- Deleted dead code: `utils/db_repo.py` (584 lines, zero importers), `utils/models.py`,
  `utils/emailer.py` (near-duplicate of `notificationservice/email.py`, now the single emailer),
  the empty legacy `/api/v1/scans` router, `__import__('sqlalchemy')` hacks in `asm_models.py`.

**Go workers** — consumer handlers aligned to one shape (typed contract struct, `HandleJob(body)`,
same logging style); raw queue-message bodies no longer logged (only type + ids); joke HTML root
handler replaced with a JSON health response (same path/status); `resume.cfg` droppings deleted.
No changes to queue names, DLX args, message structs, ack/nack, control-plane HTTP contract, or Redis state.

**Reporting** — `sanitize.py` is the only sanitization path (domain.py's duplicate ANSI cleaners
removed; equivalence proven by test); `AsmDiscoveryRun` found-or-create deduped from 6 files into
`asm/assets/common.py`; the incremental-vs-final storage duplication collapsed (both paths alive);
logging converted to %-style without emoji; `_SLA_DAYS` imported from the shared constant.

**Frontend** — one `apiFetch`/`apiFetchBlob`/`buildQuery` in `lib/api.ts` (replaced 8 duplicate query
builders + 4 raw-fetch download helpers); one `useMe()` hook (replaced 11 independent `getMe()` +
`canWrite` derivations — 11 profile fetches per session → 1); one `STATUS_META` registry in
`components/shared/StatusBadge.tsx` (replaced 5 status switch statements, pixel-identical);
`lib/csv.ts` used everywhere (and fixed to RFC-4180 escaping); shared `useDebouncedValue` for search
inputs (debounces typing only — pagination/sort/mount fire immediately); `DiscoveryManager.tsx` export
renamed to match its filename; dead `lib/services/scans.ts` deleted.

## Known accepted differences (uniformity > byte-parity)

- ASM's 401/403 detail strings now match VS/CA (`Missing bearer token`, `Invalid or expired
  authentication token`, `Insufficient permissions for this action`, plus `WWW-Authenticate` header),
  and one `"forbidden"` became `"Forbidden"`. No in-repo consumer matched the old strings.
- ASM auth no longer degrades to the token's `app_metadata` role when identity-sync fails (a
  bootstrap-era crutch with role-spoofing risk); it now behaves like VS/CA already did.
- `CONTACT_EMAIL` no longer defaults to a hardcoded personal inbox — it must be set in the
  environment (it is set in `.env`; `.env.example` documents it).
- Download requests now get `apiFetch`'s 401 sign-out and server-error surfacing.

## Deliberately not changed (documented contracts — see spec §5)

Queue names/envelopes/DLX args; Redis `asm:pipeline:{job_id}` shape; ASM member-id tenancy semantics;
reports-API camelCase JSON; ASM `LIGHT/NORMAL/DEEP` enum casing (stored data + Go contract); naive-UTC
datetimes; alembic revision ids and the `cybersentinel.ca_allow_delete` trigger GUC; the ASM
control-plane HTTP hop (declared target: fold into consumer like VS, out of scope here);
`DiscoveryManager` per-tab split (tabs share tangled state — rename-only done);
`DiscoveryManager` has no write-role gating (pre-existing gap, unchanged).

## Verification

- FastAPI route table: 168 routes, byte-identical to pre-refactor.
- `pytest`: 97 passed / 10 skipped (the 3 `test_settings.py` failures are a pre-existing local-env
  issue — they fail identically on the untouched HEAD).
- `go build ./... && go vet ./...`: clean. `tsc --noEmit` + `vite build`: clean.
- `compileall` clean for api_service, reporting, notificationservice.
- Cross-language contract greps: `jobs.asm/jobs.vs/report.asm/report.vs`, `X-Internal-Token`,
  `/api/v1/internal/vs/credential` — all unchanged.

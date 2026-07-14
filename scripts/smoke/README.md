# Smoke test — verify the full ASM / VS / CA flow, one step at a time

Runs the redesigned worker + the unified reporting consumer against the local
infra (Postgres/Redis/RabbitMQ) and drives one job of each type end-to-end.

Use **3 terminals**. Run `source scripts/smoke/env.sh` at the top of EACH one
(sets `$PY`, `$PYTHONPATH`, `$PGPASSWORD`, and helpers `pg`, `rediscli`, `rabbitq`, `taskstate`).

---

## Terminal A — reporting consumers (watch them persist findings)

```bash
cd /Users/mac/pnkj/cyberSentinel && source scripts/smoke/env.sh
$PY -m backend.reporting.asm & $PY -m backend.reporting.vs & $PY -m backend.reporting.ca &   # all three
# or one at a time in its own terminal: $PY -m backend.reporting.asm   (.vs / .ca)
```
Leave it running. Each consumes `reporting.<service>` → writes findings + updates run status + notifies.

## Terminal B — the worker (watch it run stages)

```bash
cd /Users/mac/pnkj/cyberSentinel && source scripts/smoke/env.sh
( cd worker && go build -o /tmp/cs-worker . && .//tmp/cs-worker )     # or: /tmp/cs-worker
```
You'll see it verify tools, connect Redis, and `consumer started ... queues=[asm.* vs.* ca.*]`.

## Terminal C — driver (seed, enqueue, verify)

```bash
cd /Users/mac/pnkj/cyberSentinel && source scripts/smoke/env.sh
```

### 0. Prereqs (once)
```bash
docker ps --format '{{.Names}}' | grep cybersentinel          # postgres/redis/rabbitmq up?
pg -c "SELECT version_num FROM alembic_version;"              # should be scan_redesign_task_states
```

### 1. Seed org + asset + discovery + VS run + member  → capture IDs
```bash
eval "$($PY scripts/smoke/seed.py)"
echo "ORG=$ORG_ID  DISC=$DISC_ID  VS_RUN=$VS_RUN_ID  ASSET=$ASSET_ID  CA=$CA_TASK_ID"
```

### 2. ASM — enqueue and watch
Fast path (asset_type=user → single stage, completes in seconds; proves the terminal + notification):
```bash
$PY scripts/smoke/publish.py asm $DISC_ID $ORG_ID '["example.com"]' LIGHT '{"asset_type":"user"}' $ASSET_ID
sleep 8
taskstate $DISC_ID                                            # status should be COMPLETED
pg -c "SELECT status FROM asm_discoveries WHERE id='$DISC_ID';"          # COMPLETED
pg -c "SELECT type,title FROM notifications WHERE org_id='$ORG_ID';"     # scan.completed | ASM scan completed
```
Real recon path (domain pipeline: subfinder→crtsh→ai→dnsx→http_probe→httpx). Slow if the domain has many CT-log subdomains:
```bash
$PY scripts/smoke/publish.py asm $DISC_ID $ORG_ID '["example.com"]' LIGHT '{"asset_type":"domain"}' $ASSET_ID
# watch Terminal B; then:
pg -c "SELECT count(*) FROM asm_subdomains WHERE asm_discovery_id='$DISC_ID';"
pg -c "SELECT count(*) FROM asm_ips        WHERE asm_discovery_id='$DISC_ID';"
```

### 3. VS — enqueue and watch
```bash
$PY scripts/smoke/publish.py vs $VS_RUN_ID $ORG_ID '["example.com"]' NORMAL \
  '{"scan_id":"'"$VS_SCAN_ID"'","engines":["sslyze","nmap_nse"],"safe_mode":false,"max_requests_per_sec":0,"vs_targets":[{"asset_id":"'"$ASSET_ID"'","host":"example.com"}]}'
sleep 15
taskstate $VS_RUN_ID                                          # COMPLETED
pg -c "SELECT source_engine,plugin_id,severity FROM vs_findings WHERE scan_run_id='$VS_RUN_ID';"
pg -c "SELECT status FROM vs_scan_runs WHERE id='$VS_RUN_ID';"            # COMPLETED
```

### 4. CA — enqueue and watch
```bash
$PY scripts/smoke/publish.py ca $CA_TASK_ID $ORG_ID '[]' NORMAL '{"scope":"org"}'
sleep 6
taskstate $CA_TASK_ID                                         # COMPLETED
# CA triggers the Python compliance engine; with no frameworks seeded it yields 0 gaps (expected).
# (Terminal A shows no error = trigger ran cleanly.)
```

### 5. Cleanup
```bash
pg -c "DELETE FROM organizations WHERE name LIKE 'SMOKE%';"   # cascades assets/discoveries/findings/notifications
rediscli --scan --pattern 'task:*' | xargs -r -n50 docker exec cybersentinel-redis-1 redis-cli DEL
for q in asm.medium vs.medium ca.medium reporting; do rabbitq purge_queue $q; done
```
Then Ctrl-C the worker (Terminal B) and reporting consumer (Terminal A).

---

### Notes
- Python must be **3.11** (`.venv-run`); 3.14 breaks asyncpg/greenlet.
- `taskstate <id>` pretty-prints the live Redis `task:{id}` JSON (status + per-stage progress).
- To reach the worker's own SSE/cancel via the API instead of Redis, start the API too:
  `cd backend/api_service && $PY -m uvicorn main:app --port 8000` (set `CONTROL_PLANE_TOKEN` in `.env` for the internal enqueue endpoint).

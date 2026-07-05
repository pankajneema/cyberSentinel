#!/usr/bin/env bash
#
# VS module end-to-end smoke test against a LIVE stack.
# See docs/VS-LIVE-VALIDATION.md for the full runbook.
#
# Usage:
#   export TOKEN="<supabase access token for an owner/admin/analyst user>"
#   export BASE="http://localhost:8000/api/v1"
#   export ASSET_ID="<an ownership-verified asset id in that user's org>"
#   ./vs_smoke_test.sh
#
# Requires: curl, python3. Drives create-profile -> create-scan -> run ->
# poll-run -> findings/dashboard/compliance/trends. Exits non-zero on failure.
set -euo pipefail

BASE="${BASE:?set BASE, e.g. http://localhost:8000/api/v1}"
TOKEN="${TOKEN:?set TOKEN to a Supabase access token}"
ASSET_ID="${ASSET_ID:?set ASSET_ID to an ownership-verified asset id}"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# jq-free JSON field extractor.
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1"; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; exit 1; }

step "1. Create scan profile (nuclei, safe-mode)"
PROFILE=$(curl -fsS "${AUTH[@]}" -X POST "$BASE/vs/profiles" \
  -d '{"name":"smoke","intensity":"standard","engines":["nuclei"],"safe_mode":true}')
PROFILE_ID=$(echo "$PROFILE" | jget "['id']") || fail "no profile id"
ok "profile $PROFILE_ID"

step "2. Create scan targeting the verified asset"
SCAN=$(curl -fsS "${AUTH[@]}" -X POST "$BASE/vs/scans" \
  -d "{\"name\":\"smoke-scan\",\"profile_id\":\"$PROFILE_ID\",\"asset_ids\":[\"$ASSET_ID\"],\"schedule_type\":\"QUICK\"}")
SCAN_ID=$(echo "$SCAN" | jget "['id']") || fail "no scan id"
ok "scan $SCAN_ID"

step "3. Run the scan (ownership + SSRF gate must pass)"
RUN=$(curl -fsS "${AUTH[@]}" -X POST "$BASE/vs/scans/$SCAN_ID/run")
echo "$RUN" | jget "['status']" | grep -q RUNNING && ok "scan RUNNING" || fail "scan not RUNNING: $RUN"

step "4. Poll the run to a terminal state (up to 5 min)"
for i in $(seq 1 60); do
  RUNS=$(curl -fsS "${AUTH[@]}" "$BASE/vs/scans/$SCAN_ID/runs")
  ST=$(echo "$RUNS" | jget "[0]['status']" 2>/dev/null || echo "?")
  printf '  run status: %s\n' "$ST"
  case "$ST" in
    COMPLETED) ok "run COMPLETED"; break ;;
    FAILED)    fail "run FAILED (check worker + report.vs consumer logs): $RUNS" ;;
  esac
  [ "$i" = "60" ] && fail "run did not finish in 5 min (worker/queue not processing?)"
  sleep 5
done

step "5. Findings persisted + composite-scored"
FINDINGS=$(curl -fsS "${AUTH[@]}" "$BASE/vs/findings?page_size=5")
TOTAL=$(echo "$FINDINGS" | jget "['total']")
ok "findings total=$TOTAL (0 is valid if the target is clean)"
if [ "$TOTAL" -gt 0 ]; then
  echo "$FINDINGS" | jget "['items'][0]['composite_risk']" >/dev/null && ok "composite_risk present"
  echo "$FINDINGS" | jget "['items'][0]['risk_factors']" >/dev/null && ok "risk_factors ('why') present"
fi

step "6. Dashboard / compliance / trends are REAL (no 4.2/87)"
DASH=$(curl -fsS "${AUTH[@]}" "$BASE/vs/dashboard")
echo "$DASH" | jget "['scan_coverage']" >/dev/null && ok "dashboard coverage=$(echo "$DASH" | jget "['scan_coverage']")"
curl -fsS "${AUTH[@]}" "$BASE/vs/compliance" >/dev/null && ok "compliance endpoint responds"
curl -fsS "${AUTH[@]}" "$BASE/vs/trends" >/dev/null && ok "trends endpoint responds"

step "7. Executive report renders a real PDF"
curl -fsS "${AUTH[@]}" "$BASE/vs/report?report_type=executive&format=pdf" -o /tmp/vs-smoke.pdf
head -c4 /tmp/vs-smoke.pdf | grep -q '%PDF' && ok "real PDF (%PDF)" || fail "report is not a PDF"

printf '\n\033[32mVS smoke test PASSED\033[0m\n'

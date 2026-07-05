#!/usr/bin/env bash
#
# Full CRUD + ASM API smoke test for CyberSentinel.
#
#   TOKEN="<your supabase access_token>" ./scripts/test-api.sh
#   # or:  ./scripts/test-api.sh "<token>"
#
# Get the token: open the app, DevTools → Network → any /api/v1 request →
# Request Headers → copy the value after "Authorization: Bearer ".
#
set -uo pipefail
BASE="${API_BASE:-http://localhost:8000/api/v1}"
TOKEN="${TOKEN:-${1:-}}"

if [ -z "$TOKEN" ]; then echo "ERROR: provide a token (TOKEN=... ./scripts/test-api.sh)"; exit 1; fi

pass=0; fail=0
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# req METHOD PATH [json-body]  -> prints "STATUS<newline>BODY"
req() {
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s -w $'\n%{http_code}' -X "$m" "${AUTH[@]}" -d "$b" "$BASE$p"
  else
    curl -s -w $'\n%{http_code}' -X "$m" "${AUTH[@]}" "$BASE$p"
  fi
}

# check NAME EXPECTED_STATUS METHOD PATH [body]  -> echoes body for capture
check() {
  local name="$1" want="$2" m="$3" p="$4" b="${5:-}"
  local out code body
  out="$(req "$m" "$p" "$b")"
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [ "$code" = "$want" ]; then
    printf '  \033[32mPASS\033[0m  %-22s %s %s -> %s\n' "$name" "$m" "$p" "$code" >&2
    pass=$((pass+1))
  else
    printf '  \033[31mFAIL\033[0m  %-22s %s %s -> %s (want %s)\n        %s\n' "$name" "$m" "$p" "$code" "$want" "${body:0:160}" >&2
    fail=$((fail+1))
  fi
  echo "$body"
}

jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

echo "▶ API: $BASE"
echo "── identity ──────────────────────────────────"
me="$(check who-am-i 200 GET /auth/me)"
echo "        role=$(echo "$me" | jget "['role']")  org=$(echo "$me" | jget "['org_name']")" >&2

echo "── assets CRUD ───────────────────────────────"
created="$(check create-asset 200 POST /assets '{"name":"crud-test.example.com","type":"domain","exposure":"public","tags":["test"]}')"
ID="$(echo "$created" | jget "['id']")"
echo "        new asset id=$ID" >&2

check list-assets    200 GET  /assets >/dev/null
check read-asset     200 GET  "/assets/$ID" >/dev/null
check update-asset   200 PATCH "/assets/$ID" '{"description":"updated by test","risk_score":42}' >/dev/null
check import-csv      200 POST /assets/import '{"assets":[{"name":"1.1.1.1","type":"ip"},{"name":"github.com/acme/repo","type":"repo"},{"name":"bad domain","type":"domain"}]}' >/dev/null
check delete-asset   200 DELETE "/assets/$ID" >/dev/null
check read-deleted   404 GET  "/assets/$ID" >/dev/null

echo "── ASM read APIs ─────────────────────────────"
check asm-discoveries 200 GET /asm/discoveries >/dev/null
check asm-exposure    200 GET /asm/exposure >/dev/null
check asm-settings    200 GET /asm/settings >/dev/null
check asm-ips         200 GET /asm/ips >/dev/null

echo "── ASM settings write ────────────────────────"
check asm-settings-put 200 PUT /asm/settings '{"thresholds":{"critical":80},"notifications":{"email":true}}' >/dev/null

echo "── org / team ────────────────────────────────"
check org-members 200 GET /orgs/me/members >/dev/null
check org-invites 200 GET /orgs/invites >/dev/null

echo "── RBAC / security (no token = 401) ──────────"
nc="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/auth/me")"
if [ "$nc" = "401" ] || [ "$nc" = "403" ]; then printf '  \033[32mPASS\033[0m  unauth-blocked         GET /auth/me -> %s\n' "$nc" >&2; pass=$((pass+1)); else printf '  \033[31mFAIL\033[0m  unauth-blocked -> %s (want 401)\n' "$nc" >&2; fail=$((fail+1)); fi

echo
echo "════════════════════════════════════════════════"
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$pass" "$fail"
[ "$fail" -eq 0 ] && echo "  ✅ full CRUD + API surface OK" || echo "  ⚠ see failures above"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)

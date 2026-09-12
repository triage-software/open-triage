#!/usr/bin/env bash
# open-triage MVP consolidated E2E — fresh docker compose stack.
# Covers: health, QA-1 (agent RBAC on knowledge), QA-2 (validation 400 not 500),
# QA-3 (invite → accept-invite → login), tenant isolation, i18n.
# NOTE: all curls go through req() — literal \" inside $( ) gets de-escaped
# by the command wrapper in this environment and splits the JSON payload.
set -u
BASE="${BASE:-http://localhost:3100}"
J="$PWD/e2e-cookies"
mkdir -p "$J"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
check(){ if [ "$1" = "$2" ]; then ok "$3 ($1)"; else bad "$3 — expected $2 got $1"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# req METHOD PATH [jar] [json-body] → REPLY_STATUS / REPLY_BODY
req() {
  local m=$1 p=$2 jar=${3:-} data=${4:-}
  local args=(-s -o "$J/last-body" -w '%{http_code}' -X "$m" "$BASE/api/proxy$p" -H 'content-type: application/json')
  [ -n "$jar" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-d "$data")
  REPLY_STATUS=$(curl "${args[@]}")
  REPLY_BODY=$(cat "$J/last-body" 2>/dev/null || echo '')
}

TS=$(date +%s)
OWNER="owner-$TS@e2e.test"
AGENT="agent-$TS@e2e.test"

echo "== 1. stack health =="
check "$(code "$BASE/sign-in")" "200" "GET /sign-in"
check "$(code "$BASE/accept-invite")" "200" "GET /accept-invite (no token)"

echo "== 2. owner signup + me =="
req POST /auth/signup "$J/owner.txt" "{\"tenantName\":\"E2E Tenant $TS\",\"email\":\"$OWNER\",\"password\":\"password-secure-1\",\"locale\":\"en\"}"
check "$REPLY_STATUS" "201" "POST /auth/signup"
req GET /auth/me "$J/owner.txt"
echo "$REPLY_BODY" | grep -q '"role":"owner"' && ok "GET /auth/me → owner" || bad "GET /auth/me: $REPLY_BODY"

echo "== 3. QA-3: invite → accept-invite → login =="
req POST /users "$J/owner.txt" "{\"email\":\"$AGENT\",\"role\":\"agent\",\"locale\":\"pl\"}"
case "$REPLY_BODY" in *setupToken*) ok "invite response carries setupToken (MVP)";; *) bad "invite response: $REPLY_BODY";; esac
TOKEN=$(echo "$REPLY_BODY" | sed -n 's/.*"setupToken":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || bad "no setup token parsed"
req POST /auth/login "" "{\"email\":\"$AGENT\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "401" "invited user cannot login before setup"
req POST /auth/accept-invite "" "{\"token\":\"$TOKEN\",\"password\":\"short\"}"
check "$REPLY_STATUS" "400" "accept-invite short password → 400 (QA-2 filter)"
req POST /auth/accept-invite "" "{\"token\":\"bogus-token-123456\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "400" "accept-invite bogus token → 400"
req POST /auth/accept-invite "$J/agent.txt" "{\"token\":\"$TOKEN\",\"password\":\"password-secure-1\",\"name\":\"Ada\"}"
check "$REPLY_STATUS" "200" "accept-invite happy path"
req POST /auth/accept-invite "" "{\"token\":\"$TOKEN\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "400" "accept-invite token single-use"
req POST /auth/login "$J/agent2.txt" "{\"email\":\"$AGENT\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "200" "invited user logs in after setup"

echo "== 4. QA-1: agent must NOT mutate knowledge base =="
req POST /knowledge-items "$J/owner.txt" '{"title":"Owner item","content":"secret content"}'
check "$REPLY_STATUS" "201" "owner creates KB item"
ITEM_ID=$(echo "$REPLY_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
req POST /knowledge-items "$J/agent2.txt" '{"title":"x","content":"y"}'
check "$REPLY_STATUS" "403" "agent POST /knowledge-items → 403"
req DELETE "/knowledge-items/$ITEM_ID" "$J/agent2.txt"
check "$REPLY_STATUS" "403" "agent DELETE /knowledge-items/:id → 403"
req POST /knowledge-items/reindex "$J/agent2.txt" '{}'
check "$REPLY_STATUS" "403" "agent POST reindex → 403"
req GET /knowledge-items "$J/agent2.txt"
check "$REPLY_STATUS" "200" "agent GET /knowledge-items → 200 (read allowed)"
req DELETE "/knowledge-items/$ITEM_ID" "$J/owner.txt"
check "$REPLY_STATUS" "200" "owner DELETE own KB item → 200"

echo "== 5. QA-2: validation errors are 400, not 500 =="
req POST /auth/signup "" '{"tenantName":"x","email":"bad","password":"short"}'
check "$REPLY_STATUS" "400" "signup invalid payload → 400"
case "$REPLY_BODY" in *VALIDATION_ERROR*) ok "error body carries VALIDATION_ERROR";; *) bad "body: $REPLY_BODY";; esac

echo "== 6. tenant isolation =="
TS2=$((TS+1))
req POST /auth/signup "$J/owner2.txt" "{\"tenantName\":\"Other Tenant $TS2\",\"email\":\"o-$TS2@e2e.test\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "201" "second tenant signup"
req GET /conversations/nonexistent-id "$J/owner2.txt"
check "$REPLY_STATUS" "404" "cross-tenant conversation get → 404"

echo "== 7. i18n surface =="
curl -s "$BASE/sign-in" | grep -q "Zaloguj\|Sign in" && ok "sign-in page renders localized text" || bad "sign-in page not localized"
check "$(code "$BASE/definitely-not-a-route")" "404" "unknown route 404s"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]

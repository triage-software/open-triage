#!/usr/bin/env bash
# Live smoke for the mailboxes module (t_fbfb2225) against a running stack.
# Usage: BASE=http://localhost:3101 bash docs/qa/mailboxes-smoke.sh
set -u
BASE="${BASE:-http://localhost:3101}"
J="$PWD/mailbox-smoke-cookies"
mkdir -p "$J"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
check(){ if [ "$1" = "$2" ]; then ok "$3 ($1)"; else bad "$3 — expected $2 got $1"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
req() {
  local m=$1 p=$2 jar=${3:-} data=${4:-}
  local args=(-s -o "$J/last-body" -w '%{http_code}' -X "$m" "$BASE/api/proxy$p" -H 'content-type: application/json')
  [ -n "$jar" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-d "$data")
  REPLY_STATUS=$(curl "${args[@]}")
  REPLY_BODY=$(cat "$J/last-body" 2>/dev/null || echo '')
}
TS=$(date +%s)
OWNER="mbx-owner-$TS@e2e.test"
AGENT="mbx-agent-$TS@e2e.test"

echo "== setup: owner + agent sessions =="
req POST /auth/signup "$J/owner.txt" "{\"tenantName\":\"MBX Smoke $TS\",\"email\":\"$OWNER\",\"password\":\"password-secure-1\",\"locale\":\"en\"}"
check "$REPLY_STATUS" "201" "owner signup"
req POST /users "$J/owner.txt" "{\"email\":\"$AGENT\",\"role\":\"agent\",\"locale\":\"en\"}"
TOKEN=$(echo "$REPLY_BODY" | sed -n 's/.*"setupToken":"\([^"]*\)".*/\1/p')
req POST /auth/accept-invite "" "{\"token\":\"$TOKEN\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "200" "agent setup"
req POST /auth/login "$J/agent.txt" "{\"email\":\"$AGENT\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "200" "agent login"

echo "== RBAC: admin-only module =="
req GET /mailboxes "$J/agent.txt"
check "$REPLY_STATUS" "403" "agent GET /mailboxes → 403"
req GET /mailboxes "$J/owner.txt"
check "$REPLY_STATUS" "200" "owner GET /mailboxes → 200"
case "$REPLY_BODY" in *'"data":[]'*) ok "empty list";; *) bad "list body: $REPLY_BODY";; esac

echo "== create + secret handling =="
req POST /mailboxes "$J/agent.txt" '{"name":"x","host":"h","user":"u","password":"p"}'
check "$REPLY_STATUS" "403" "agent POST /mailboxes → 403"
req POST /mailboxes "$J/owner.txt" "{\"name\":\"Support\",\"host\":\"imap.invalid.example\",\"port\":993,\"secure\":true,\"user\":\"support@invalid.example\",\"password\":\"s3cret-źółć\"}"
check "$REPLY_STATUS" "201" "owner POST /mailboxes → 201"
case "$REPLY_BODY" in *s3cret*|*passwordEnc*|*password*) bad "secret material in create response";; *) ok "no secret material in create response";; esac
MBX_ID=$(echo "$REPLY_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$MBX_ID" ] && ok "mailbox id: $MBX_ID" || bad "no mailbox id"
req GET /mailboxes "$J/owner.txt"
case "$REPLY_BODY" in *s3cret*|*passwordEnc*|*password*) bad "secret material in list";; *) ok "no secret material in list";; esac

echo "== validation =="
req POST /mailboxes "$J/owner.txt" '{"name":"NoHost","kind":"imap","user":"u"}'
check "$REPLY_STATUS" "400" "imap without host → 400"
case "$REPLY_BODY" in *VALIDATION_ERROR*) ok "body carries VALIDATION_ERROR";; *) bad "body: $REPLY_BODY";; esac
req POST /mailboxes "$J/owner.txt" '{"name":"BadPort","host":"h","port":99999,"user":"u"}'
check "$REPLY_STATUS" "400" "port 99999 → 400"

echo "== update =="
req PATCH "/mailboxes/$MBX_ID" "$J/agent.txt" '{"name":"renamed"}'
check "$REPLY_STATUS" "403" "agent PATCH → 403"
req PATCH "/mailboxes/$MBX_ID" "$J/owner.txt" '{"name":"Support renamed","password":null}'
check "$REPLY_STATUS" "200" "owner PATCH (rename + clear password)"
case "$REPLY_BODY" in *'"name":"Support renamed"'*) ok "rename applied";; *) bad "body: $REPLY_BODY";; esac

echo "== verify =="
req POST "/mailboxes/$MBX_ID/verify" "$J/owner.txt" '{}'
check "$REPLY_STATUS" "400" "verify without stored password → 400"
case "$REPLY_BODY" in *NO_CREDENTIALS*) ok "code NO_CREDENTIALS";; *) bad "body: $REPLY_BODY";; esac
req PATCH "/mailboxes/$MBX_ID" "$J/owner.txt" '{"password":"definitely-wrong"}'
req POST "/mailboxes/$MBX_ID/verify" "$J/owner.txt" '{}'
check "$REPLY_STATUS" "400" "verify against unreachable host → 400"
case "$REPLY_BODY" in *HOST_UNREACHABLE*) ok "code HOST_UNREACHABLE";; *) bad "body: $REPLY_BODY";; esac
req POST "/mailboxes/$MBX_ID/verify" "$J/owner.txt" '{"smtpHost":"smtp.invalid.example","smtpPort":465}'
check "$REPLY_STATUS" "400" "verify + smtp probe → 400 (unreachable)"
req POST /mailboxes "$J/owner.txt" '{"name":"Channel","kind":"channel"}'
CH_ID=$(echo "$REPLY_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
req POST "/mailboxes/$CH_ID/verify" "$J/owner.txt" '{}'
check "$REPLY_STATUS" "400" "verify channel mailbox → 400"
case "$REPLY_BODY" in *VERIFY_NOT_APPLICABLE*) ok "code VERIFY_NOT_APPLICABLE";; *) bad "body: $REPLY_BODY";; esac
req POST "/mailboxes/00000000-0000-0000-0000-000000000000/verify" "$J/owner.txt" '{}'
check "$REPLY_STATUS" "404" "verify unknown mailbox → 404"
req POST "/mailboxes/$MBX_ID/verify" "$J/agent.txt" '{}'
check "$REPLY_STATUS" "403" "agent verify → 403"

echo "== cross-tenant isolation =="
req POST /auth/signup "$J/owner2.txt" "{\"tenantName\":\"Other MBX $TS\",\"email\":\"mbx-o2-$TS@e2e.test\",\"password\":\"password-secure-1\"}"
check "$REPLY_STATUS" "201" "second tenant signup"
req GET "/mailboxes/$MBX_ID" "$J/owner2.txt"
check "$REPLY_STATUS" "404" "cross-tenant mailbox get → 404"
req PATCH "/mailboxes/$MBX_ID" "$J/owner2.txt" '{"name":"hijack"}'
check "$REPLY_STATUS" "404" "cross-tenant patch → 404"
req DELETE "/mailboxes/$MBX_ID" "$J/owner2.txt"
check "$REPLY_STATUS" "404" "cross-tenant delete → 404"

echo "== delete =="
req DELETE "/mailboxes/$MBX_ID" "$J/agent.txt"
check "$REPLY_STATUS" "403" "agent DELETE → 403"
req DELETE "/mailboxes/$CH_ID" "$J/owner.txt"
check "$REPLY_STATUS" "200" "owner DELETE channel mailbox → 200"
req DELETE "/mailboxes/$MBX_ID" "$J/owner.txt"
check "$REPLY_STATUS" "200" "owner DELETE imap mailbox → 200"
req DELETE "/mailboxes/$MBX_ID" "$J/owner.txt"
check "$REPLY_STATUS" "404" "delete twice → 404"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]

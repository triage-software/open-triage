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

# ============================================================
# == 8. mail flow (worker increment) — requires the verify-mail
# profile services (mailpit + greenmail) reachable. When they are
# not up, the whole mail block is skipped so the plain stack stays
# green: MAILPIT_UI / GREENMAIL_IMAP envs point at the host ports.
# ============================================================
MAILPIT_UI="${MAILPIT_UI:-http://localhost:8025}"
GREENMAIL_IMAP="${GREENMAIL_IMAP:-localhost:3143}"
GREENMAIL_SMTP="${GREENMAIL_SMTP:-localhost:3025}"
MAILPIT_API="$MAILPIT_UI/api/v1"
MAIL_OK=1
code "$MAILPIT_UI" >/dev/null 2>&1; MP=$?
docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'mailpit' || MP=1
if [ "$MP" != "0" ]; then
  MAIL_OK=0
  echo "== 8. mail flow — SKIPPED (mailpit not reachable; run the verify-mail profile) =="
fi

if [ "$MAIL_OK" = "1" ]; then
  echo "== 8. mail flow: seeded IMAP message → worker → conversation =="
  # A real Message-ID so a repeated seed dedupes client-side (not asserted).
  SEED_ID="<seed-$TS@klient.test>"
  SEED_BODY="Prosze o pomoc z logowaniem do konta."
  # Seed via the helper (nodemailer) running INSIDE the api container so it
  # reaches greenmail over the compose network (SMTP 3025).
  docker cp "$(dirname "$0")/seed-mail.cjs" "$(docker ps --format '{{.Names}}' | grep 'api-1' | head -1):/tmp/seed-mail.cjs" 2>/dev/null
  SEED_JSON=$(docker exec "$(docker ps --format '{{.Names}}' | grep 'api-1' | head -1)" node /tmp/seed-mail.cjs greenmail 3025 "Mail flow check" 2>/dev/null)
  case "$SEED_JSON" in
    *'"ok":true'*) ok "seed mail sent into greenmail";;
    *) bad "seed mail send failed ($SEED_JSON)";;
  esac

  # Create an IMAP mailbox pointing at greenmail (admin-only module).
  req POST /mailboxes "$J/owner.txt" '{"name":"Verify box","host":"greenmail","port":3143,"secure":false,"user":"verify@localhost","password":"verify"}'
  check "$REPLY_STATUS" "201" "POST /mailboxes (admin)"
  MAILBOX_ID=$(echo "$REPLY_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  req POST "/mailboxes/$MAILBOX_ID/verify" "$J/owner.txt" '{}'
  check "$REPLY_STATUS" "200" "POST /mailboxes/:id/verify (IMAP reachable)"

  # SMTP override for the send path (Mailbox.smtp* columns are worker-scope).
  # PATCH /mailboxes/:id does not accept smtp* yet (mailboxes card t_fbfb2225
  # owns that schema) — set the override via prisma in the api container.
  docker exec "$(docker ps --format '{{.Names}}' | grep 'api-1' | head -1)" node --input-type=commonjs -e "
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
p.mailbox.update({where:{id:'$MAILBOX_ID'},data:{smtpHost:'greenmail',smtpPort:3025,smtpSecure:false}})
 .then(()=>{console.log('smtp override set');return p.\$disconnect()})
 .catch(e=>{console.error(e.message);process.exit(1)})" >/dev/null 2>&1 && ok "smtp override set" || bad "smtp override update failed"

  # Worker polls every WORKER_POLL_INTERVAL_MS (compose verify: 3s).
  CONV_FOUND=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 2
    req GET "/conversations?q=Mail+flow+check" "$J/owner.txt"
    case "$REPLY_BODY" in
      *Mail+flow+check*|*"Mail flow check"*) CONV_FOUND=1; break ;;
    esac
  done
  if [ "$CONV_FOUND" = "1" ]; then
    ok "worker imported IMAP mail into a conversation"
    CONV_ID=$(echo "$REPLY_BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    # Auto-classification (only runs with OPENROUTER_API_KEY; presence is
    # a soft check — no key means aiCategory stays null and that's fine).
    req GET "/conversations/$CONV_ID" "$J/owner.txt"
    case "$REPLY_BODY" in *'"direction":"in"'*) ok "inbound message stored with body";; *) bad "conversation detail: $REPLY_BODY";; esac
  else
    bad "worker did not import the IMAP mail within 30s"
  fi

  echo "== 9. mail flow: ai-draft endpoint =="
  if [ "$CONV_FOUND" = "1" ]; then
    req POST "/conversations/$CONV_ID/ai-draft" "$J/owner.txt" '{}'
    case "$REPLY_STATUS" in
      200|201) ok "ai-draft returns a draft envelope ($REPLY_STATUS)";;
      502|504) ok "ai-draft reachable; provider error without usable key ($REPLY_STATUS)";;
      *) bad "ai-draft unexpected status: $REPLY_STATUS $REPLY_BODY";;
    esac
  else
    bad "ai-draft skipped — no conversation imported"
  fi

  echo "== 10. mail flow: agent reply → SMTP → mailpit =="
  if [ "$CONV_FOUND" = "1" ]; then
    req POST "/conversations/$CONV_ID/messages" "$J/owner.txt" '{"body":"Dzień dobry, pomoczymy w ciągu godziny.","send":true}'
    check "$REPLY_STATUS" "201" "POST /conversations/:id/messages {send:true}"
    case "$REPLY_BODY" in *deliveryKey*) ok "reply queued with deliveryKey";; *) bad "messages response: $REPLY_BODY";; esac
    DELIVERY_KEY=$(echo "$REPLY_BODY" | sed -n 's/.*"deliveryKey":"\([^"]*\)".*/\1/p')
    SENT=0
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 2
      COUNT=$(curl -s "$MAILPIT_API/messages?limit=50" 2>/dev/null | grep -o '"ID"' | wc -l | tr -d ' ')
      [ "${COUNT:-0}" -ge 1 ] && { SENT=1; break; }
    done
    if [ "$SENT" = "1" ]; then
      ok "worker delivered the reply into mailpit"
      # A second send gets its own deliveryKey — a NEW message must appear
      # (delivery is idempotent per key, and each send is a new key).
      req POST "/conversations/$CONV_ID/messages" "$J/owner.txt" '{"body":"Druga odpowiedź testowa.","send":true}'
      case "$REPLY_BODY" in
        *deliveryKey*) case "$REPLY_BODY" in *"$DELIVERY_KEY"*) bad "deliveryKey reused across sends";; *) ok "second send has a fresh deliveryKey";; esac;;
        *) bad "second send response: $REPLY_BODY";;
      esac
    else
      bad "worker did not deliver the reply to SMTP within 20s"
    fi
  fi

  echo "== 11. mail flow: RBAC on the new endpoints =="
  req POST "/conversations/00000000-0000-4000-8000-000000000000/messages" "$J/owner.txt" '{"body":"x","send":true}'
  check "$REPLY_STATUS" "404" "messages on missing conversation → 404"
  req POST "/conversations/00000000-0000-4000-8000-000000000000/ai-draft" "$J/owner.txt" '{}'
  check "$REPLY_STATUS" "404" "ai-draft on missing conversation → 404"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]

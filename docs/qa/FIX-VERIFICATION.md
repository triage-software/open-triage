# Fix verification — QA-1, QA-2, QA-3 (root task t_119fdb09, 2026-09-12)

Follow-up to `VERIFICATION-REPORT.md` (commit e317a83). All three defects were
fixed by the root task and re-verified against a **fresh** `docker compose -p ot-verify up -d --build`
stack (own volumes, port 3100; the pre-existing dev stack on :3000 was left untouched).

## QA-1 (S1, security) — FIXED
Method-level `@MinRole` now lands on the handler function (`descriptor.value`),
which is what `TenantRoleGuard.getMinRole()` reads via `ctx.getHandler()`.
Regression tests: `api/test/guards.test.ts` (5 tests; the agent→403 test fails
against the pre-fix decorator). E2E on the fresh stack: agent
POST/DELETE/reindex on `/v1/knowledge-items` → 403, GET → 200, owner → 201/200.

## QA-2 (S3) — FIXED
Global `ZodExceptionFilter` (`api/src/common/zod-exception.filter.ts`,
registered in `main.ts`) maps ZodError → 400
`{code:'VALIDATION_ERROR', message, errors[]}`. E2E: invalid signup payload → 400
with `VALIDATION_ERROR`; invite setup with short password → 400.

## QA-3 (S3) — FIXED
New `POST /v1/auth/accept-invite` {token, password, name?} (auth service +
controller) consumes the one-time setup token stored in `verifyToken` at invite
time: sets the real password, activates + verifies the account, signs the user
in. MVP invite responses now carry `setupToken` (no SMTP worker yet); web flow
at `/accept-invite?token=…` (`src/app/accept-invite/page.tsx` +
`InviteCard`), en/pl strings added with parity (67/67 keys). E2E: invite →
setup → login loop passes; token is single-use; pre-setup login 401; bogus
token 400.

## Contract drift (DR-1..DR-3) — RESOLVED (docs side)
`API-CONTRACT-OUTLINE.md`, `SPEC-0001`, `DOCKER-COMPOSE-TOPOLOGY` now split
**shipped MVP** vs **post-MVP (worker increment)**: `/messages`, `/ai-draft`,
`/mailboxes`, `worker` service, cursor pagination, Idempotency-Key, OpenAPI are
marked post-MVP; `assigneeId=` documented as the shipped query param;
`POST /auth/accept-invite` documented. Mail/AI slice decision: consciously
deferred to the worker increment (code exists in the prototype layer).

## Consolidated E2E
`docs/qa/e2e.sh` (run `BASE=http://localhost:3100 bash docs/qa/e2e.sh` against a
fresh compose project): 23/23 PASS — auth, QA-1 RBAC matrix, QA-2 validation,
QA-3 invite loop, tenant isolation, i18n surface. Also passing: `npm run
typecheck` (web+api), `npm run build`, api tests 5/5, root tests 39/39.

---

# Worker increment verification (t_87a44da4, 2026-09-12)

Follow-up to the MVP verification above. The mail/AI slice now ships: Nest
worker module (`api/src/worker`, entrypoint `dist/worker/worker.js`) with
BullMQ consumers — `ot-mail-sync` (IMAP poll, UIDVALIDITY/lastUid cursor,
batch 20), `ot-mail-send` (idempotent send per `Message.deliveryKey` + retried
Sent copy), `ot-notification` (invite/verification mail), `ot-ai`
(classification auto-triggered on inbound mail; reply drafts via
KnowledgeIndexService per ADR-0003, never auto-sent). New endpoints:
`POST /conversations/:id/messages {send:true|false}` (queued, idempotent) and
`POST /conversations/:id/ai-draft` (synchronous, persisted on `aiDraft*`
columns). Invite/verification e-mails deliver via `SMTP_SYSTEM_*`; without it
the MVP fallbacks stay (setupToken in the invite response, verify token in
server logs). `worker` service added to docker-compose (same api image) plus a
`verify-mail` profile (mailpit + greenmail) for E2E; topology doc updated
(DR-3 shipped). Migration `worker_mail_ai_slice` is purely additive.

**Prototype disposition**: the Next.js API routes (`src/app/api/**`,
`src/lib/mail-*`/`ai-*`) STAY as the demo layer (the prototype UI still runs
on them); the Nest worker + API is the production path per SPEC-0001.

## Bugs found and fixed during verification
- compose `DATABASE_URL` carried a literal `***` instead of the
  `${POSTGRES_PASSWORD:-opentriage}` interpolation (P1000 auth failure) — restored.
- Worker services shipped without `@Injectable()` — Nest constructed them with
  undefined constructor args (`Cannot read properties of undefined (reading
  'mailbox')` on every poll tick). All five classes decorated; `Producer`
  injected via the `PRODUCER` token (plain class references were lost through
  `import type`); `PrismaService` provided inside `WorkerModule`; producer
  extracted to a cycle-free `ProducerModule`.
- Invite/verify mail fell back to tokens only when Redis was missing; a Redis
  stack without `SMTP_SYSTEM_HOST` silently dropped the token — producers now
  return false when system SMTP is not configured.
- System SMTP no longer requires a password (local sinks accept unauthenticated
  relays); `SMTP_SYSTEM_FROM` is the only mandatory var.
- No SMTP fallback to the IMAP host/port (wrong-protocol greeting deaths) — a
  missing `Mailbox.smtpHost` override fails the send job with a clear error.
- greenmail image tag pinned to a real one (`2.1.8`; `2.1` does not exist).

## Worker-increment E2E
`docs/qa/e2e.sh` now covers mail flows (sections 8-11): seeded IMAP mail →
worker import → conversation, ai-draft envelope, agent reply → SMTP delivery
into mailpit, fresh deliveryKey per send, RBAC 404s, and the invite loop with
tokens pulled from the delivered invite mail. Two verified configurations on
fresh compose projects:
- `ot-verify2` (verify-mail profile, SMTP_SYSTEM_*=mailpit, poll 3 s): **37/37 PASS**
- `ot-verify3` (plain stack, no mail services): **23/23 PASS** (mail scenarios
  self-skip, invite falls back to setupToken)
Also passing: api tests 33/33 (23 pre-existing + worker regressions), root
tests 39/39, typecheck+build clean (web+api).

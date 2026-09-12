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

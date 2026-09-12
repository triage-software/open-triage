# QA Verification Report — open-triage MVP vs SPEC-0001

Date: 2026-09-12 · Commit under test: f062a14 (branch rebrand/design-system)
Environment: Docker Compose (db/redis/api healthy, web up), web :3000, api internal :4000.
Evidence: `qa-evidence/` (raw curl/JSON outputs, this run).

## Summary

**19/20 criteria PASS, 1 FAIL (defect QA-1), 2 additional defects (QA-2, QA-3), 1 spec drift (DR-1).**
Release verdict: **ship-with-known-defects** — QA-1 is a privilege-escalation bug and should be fixed before paying customers; QA-2/QA-3 are quality issues, not data leaks.

## Verdict table

| AC | Criterion | Result | Evidence |
|---|---|---|---|
| AC-1 | Compose bring-up, all healthy, migrations on api start | PASS | qa-evidence/ac1-compose.txt — api/db/redis healthy; `{"ok":true}` on /healthz; /sign-in 200 |
| AC-2 | Signup creates tenant+owner, session cookie | PASS | signup 201; /auth/me returns owner + tenant `qa-test-tenant-alpha`, plan free |
| AC-3 | Logout instant revocation | PASS | logout 200 → reused cookie 401 `UNAUTHENTICATED` (ac3-after-logout.json) |
| AC-4 | Password ≥10 chars; argon2id | PASS (API), see QA-3 | 9-char pw rejected (Zod min 10); DB hash prefix `$argon2id$v=` (ac4-hash.txt) |
| AC-5 | Cookie httpOnly+Secure+SameSite=Lax, HMAC-signed | PASS | Set-Cookie header (run 1); tampered cookie → 401 (ac5-tampered.json) |
| AC-6 | Email verification token + verify | PASS | token in api logs → POST /auth/verify 200 → me: emailVerified true |
| AC-7 | Tenant isolation (cross-tenant must fail) | PASS | A sees only own conversation; B GET A's conversation → 404; B GET A's KB item → 404; B list empty |
| AC-8 | Agent role restrictions | **FAIL (QA-1)** | agent GET /users 403 ✓, PATCH /users 403 ✓, but POST /knowledge-items **201** and POST /knowledge-items/reindex **201** |
| AC-9 | Platform admin guard | PASS | owner on /admin/tenants → 403 `PLATFORM_ADMIN_REQUIRED`; unauth admin routes 403; admin login returns platformAdmin identity |
| AC-10 | Suspend tenant → login blocked, sessions dead, unsuspend restores | PASS | suspended: existing session 401, login 401 `TENANT_SUSPENDED`; unsuspend → login 200 |
| AC-11 | Global AI settings GET/PUT persist | PASS | PUT model=test/model-x → GET returns it; restored after |
| AC-12 | Conversations list/get/patch/comment | PASS | patch status=pending priority=urgent 200; PL comment 201; detail shows both |
| AC-13 | KB reindex graceful w/o VikingDB | PASS | reindex 200 `{"indexed":0,"ok":false}`; api log warns "VikingDB … failed", no 5xx |
| AC-14 | Per-tenant Viking collections | PASS (code) | `collection(tenantId) = tenant-${tenantId}` — no cross-tenant reuse possible |
| AC-15 | en/pl i18n, ot_locale cookie, catalog parity | PASS | en: "Sign in to open-triage"; pl: "Zaloguj się do open-triage"; 68/68 keys, 0 missing/extra |
| AC-16 | Polish chars round-trip; slug transliteration | PASS | tenantName "Łódzkie Biuro…ĄęŚż" → slug `lodzkie-biuro-nieruchomosci-aesz`; KB title round-trip identical |
| AC-17 | Team invite + role-change rules | PASS | invite 201; admin cannot patch/delete owner (403); admin cannot self-promote to owner (403); owner undeletable |
| AC-18 | Deactivation kills sessions | PASS | deactivate 200 → agent's live session 401 immediately |
| AC-19 | BFF-only exposure | PASS | only web :3000 published; api/db/redis internal; host→:4000 unreachable; unauth / → 307 /sign-in; /admin guarded server-side |
| AC-20 | Unit suite | PASS | `npm test` (repo root): tests 39 / pass 39 / fail 0 (Node 24.11.1) |

UI guards (bonus): / with tenant session 200; /admin with tenant session → 307 /sign-in (correct, tenant never reaches admin surface); /admin with platform-admin session 200; / with admin session → 307 /admin (correct landing split, SPEC-0001).

## Defects

### QA-1 (S1 — security, privilege escalation): agents can create/delete knowledge items and trigger reindex
- Repro: log in as tenant agent → `POST /api/proxy/knowledge-items {title,content}` → 201; `DELETE /api/proxy/knowledge-items/:id` → 200; `POST /knowledge-items/reindex` → 200. Expected per API contract: admin-of-tenant only (403).
- Root cause (code): `MinRole` method decorator writes `minRole` onto the property **descriptor** (`descriptor.minRole`), but `TenantRoleGuard.getMinRole()` reads `ctx.getHandler().minRole` — the handler *function*, not the descriptor. Method-level `@MinRole('admin')` is therefore silently ignored; the guard falls back to `'agent'`. Class-level `@MinRole` works (that's why `POST /users` correctly 403s an agent — UsersController sets it on the class).
- Impact: within-tenant escalation only (tenant scoping intact). An agent can delete the tenant's whole KB and force reindexes. Cross-tenant unaffected.
- Fix hint: in the decorator set the property on the handler function (`descriptor.value.minRole = role`) or use Nest's `SetMetadata` + `Reflector`; add a regression test asserting agent gets 403 on KB mutations.
- Severity S1: authorization bypass (defense-in-depth failure in the role model, though blast radius is one tenant).

### QA-2 (S3 — API hygiene): invalid payload returns 500 instead of 400
- Repro: `POST /api/proxy/auth/signup` with 9-char password → HTTP 500 `{"statusCode":500,"message":"Internal server error"}`; ZodError logged as unhandled (ExceptionsHandler).
- Expected: 400 with `{code:'VALIDATION_ERROR', details}` per the API contract's error conventions. Frontend masks it (shows genericError/passwordTooShort client-side), so user impact is low, but API consumers and logs suffer.
- Fix: global Zod exception filter mapping ZodError → 400.

### QA-3 (S3 — docs/UX mismatch): invited user cannot complete setup
- Repro: owner invites agent (201, setup token only in server logs) → agent tries `POST /auth/login` with the temp password → 401 `INVALID_CREDENTIALS`. There is no endpoint or UI page to consume the setup token (`verify` only flips emailVerified).
- Expected (code comment says "invited user sets a real password on first login via setup token") — that flow does not exist in web or API. Invited teammates are dead accounts until an operator edits the DB.
- Fix: either `POST /auth/accept-invite {token,password}` + a /accept-invite page, or return the setup token in the invite response for MVP (dev-mode), documented.

## Spec drift (to architect — spec or code must change)

### DR-1: MVP API contract lists endpoints that do not ship in the MVP stack
- `API-CONTRACT-OUTLINE.md` specifies `POST /conversations/:id/messages {send:true}` (SMTP send), `POST /conversations/:id/ai-draft`, and the whole `Mailboxes` module (`GET/POST /mailboxes`, `/verify`). None exist in the composed MVP: `app.module.ts` mounts only Auth, Conversations, Users, Knowledge, PlatformAdmin; docker-compose runs no worker service and no IMAP/SMTP path is exercised.
- Also `GET /conversations` takes `assigneeId` (not the contract's `assignee=`), and responses use `{data, cursor}` rather than the contract's `{data, error?}` envelope with cursor pagination everywhere.
- Question for architect: are mail/AI endpoints consciously deferred to the next increment (then the contract needs a "shipped in MVP" marker), or is this gap? Inbox UI currently shows empty state with "connect a channel" CTA that has no backing feature in the composed stack.

## Not testable this release (with reason)

- IMAP/SMTP worker flows (mail sync, send, copy-to-Sent): worker module not part of the composed MVP stack; no IMAP/SMTP fixture. Matches DR-1.
- Live AI classification/drafting (OpenRouter + VikingDB retrieval): no OPENROUTER_API_KEY and no VikingDB endpoint in test env; graceful degradation verified instead (AC-13).
- Idempotency-Key handling (contract promises it for sends): no send endpoint exists to test.
- OAuth, SSO, audit logs, analytics, SLAs, billing: spec non-goals for MVP.

## Test data seeded for this run (reproducibility)

Tenants: QA Test Tenant Alpha (`38e664a3-…`, owner qa-owner-a@test.local, agent qa-agent-a@test.local [deactivated], admin qa-admin-a@test.local), Rival Tenant Beta (`db9c7871-…`, owner qa-owner-b@test.local), Łódzkie Biuro Nieruchomości ĄęŚż (owner qa-pl-slug@test.local). Platform admin: qa-admin@test.local. Seeded via SQL: 2 mailboxes, 2 conversations (one per tenant, PL subject with diacritics), 2 KB items. All qa-* accounts are disposable; note in DB before cleanup.

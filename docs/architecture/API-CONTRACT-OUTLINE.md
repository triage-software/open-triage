# API Contract Outline — Nest.js `api` service

Status: accepted · 2026-09-12 · Part of SPEC-0001 · **Updated post-QA (root task, 2026-09-12): shipped-MVP vs post-MVP split — see DR-1 in `docs/qa/VERIFICATION-REPORT.md`.**

Base URL `/v1`. All routes except `/auth/*` require a valid session cookie; tenant context is derived from the session's user. Responses: JSON, `{ data }` envelope (mutations return `{ data: { ok: true } }` or the created/updated record; `GET /conversations` additionally returns `cursor` — full cursor pagination lands with the worker increment). Errors: `{ code, message, details? }`; schema-validation failures are HTTP 400 `{ code: 'VALIDATION_ERROR', message, errors[] }` (global Zod filter, QA-2).

Conventions:
- Cursor pagination on every tenant-scoped list and `Idempotency-Key` on send, OpenAPI at `/v1/docs`: **post-MVP** (not in the shipped compose; do not test against MVP).
- Zod DTOs parsed in services/controllers.

## Auth
- `POST /auth/signup` {tenantName, email, password, locale} → creates tenant + owner user; verification token logged server-side in MVP (SMTP delivery is worker scope)
- `POST /auth/login` {email, password} → sets session cookie
- `POST /auth/logout`
- `GET /auth/me` → user, tenant, role, locale
- `POST /auth/accept-invite` {token, password, name?} → invited teammate sets password (one-time setup token from invite), account activated + verified, session set (QA-3). In MVP (no invite e-mail) the invite response carries `setupToken` for the inviting admin to hand over.

## Platform admin (guard: PlatformAdminGuard; base `/admin`)
- `GET /admin/tenants` · `PATCH /admin/tenants/:id` (plan, suspend)
- `GET /admin/users` (cross-tenant, read-only in MVP)
- `GET/PUT /admin/settings` (global AI provider config)

## Conversations (guard: TenantRoleGuard — agent+)
- `GET /conversations?status=&assigneeId=&mailboxId=&q=&sort=` (shipped param is `assigneeId=`)
- `GET /conversations/:id` → conversation + messages + comments
- `PATCH /conversations/:id` {status?, assigneeId?, priority?}
- `POST /conversations/:id/comments` {body} (internal note)
- `POST /conversations/:id/messages` {body, send:true} → SMTP send + store (agent+) — **post-MVP** (worker increment; exists in the Next.js prototype layer, ports into the worker module)
- `POST /conversations/:id/ai-draft` → AI-drafted reply (agent+; async job, returns jobId) — **post-MVP**

## Mailboxes (admin of tenant) — **post-MVP module**
- `GET/POST /mailboxes` · `PATCH/DELETE /mailboxes/:id`
- `POST /mailboxes/:id/verify` → IMAP/SMTP connection test
(No mailboxes controller ships in the MVP API; the Mailbox Prisma model exists. MVP inbox empty-state assumes the worker increment connects channels.)

## Knowledge base (admin of tenant)
- `GET/POST /knowledge-items` · `PATCH/DELETE /knowledge-items/:id`
- `POST /knowledge-items/reindex` → rebuild Viking collection (admin)

## Team (admin of tenant)
- `GET/POST /users` (invite) · `PATCH /users/:id` (role, locale) · `DELETE /users/:id`

## Services (Nest modules)
`AuthModule`, `TenantsModule`, `UsersModule`, `MailboxesModule`, `ConversationsModule`, `MessagesModule`, `KnowledgeModule`, `KnowledgeIndexService` (ADR-0003), `AiModule` (OpenRouter client), `PlatformAdminModule`, `MailSyncModule` (worker entrypoints: IMAP poll, SMTP send).

## Multi-tenancy enforcement
`TenantContextMiddleware` resolves tenant from session; `TenantPrismaService` middleware injects `tenant_id` filters (ADR-0001); `TenantRoleGuard` / `PlatformAdminGuard` on controllers. Tenant models have no public unscoped repository.
# API Contract Outline — Nest.js `api` service

Status: accepted · 2026-09-12 · Part of SPEC-0001 · **Updated post-QA (root task, 2026-09-12): shipped-MVP vs post-MVP split — see DR-1 in `docs/qa/VERIFICATION-REPORT.md`.**

Base URL `/v1`. All routes except `/auth/*` require a valid session cookie; tenant context is derived from the session's user. Responses: JSON, `{ data }` envelope (mutations return `{ data: { ok: true } }` or the created/updated record; `GET /conversations` additionally returns `cursor` — full cursor pagination lands with the worker increment). Errors: `{ code, message, details? }`; schema-validation failures are HTTP 400 `{ code: 'VALIDATION_ERROR', message, errors[] }` (global Zod filter, QA-2).

Conventions:
- Cursor pagination on every tenant-scoped list and `Idempotency-Key` on send, OpenAPI at `/v1/docs`: **post-MVP** (not in the shipped compose; do not test against MVP).
- Zod DTOs parsed in services/controllers.

## Auth
- `POST /auth/signup` {tenantName, email, password, locale} → creates tenant + owner user; verification e-mail queued for SMTP delivery (worker); falls back to server-side token log when system SMTP is not configured
- `POST /auth/login` {email, password} → sets session cookie
- `POST /auth/logout`
- `GET /auth/me` → user, tenant, role, locale
- `POST /auth/accept-invite` {token, password, name?} → invited teammate sets password (one-time setup token from invite), account activated + verified, session set (QA-3). When SMTP is configured the invite e-mail carries the setup link and the invite response no longer includes `setupToken`; without SMTP the MVP fallback keeps returning it to the inviting admin.

## Platform admin (guard: PlatformAdminGuard; base `/admin`)
- `GET /admin/tenants` · `PATCH /admin/tenants/:id` (plan, suspend)
- `GET /admin/users` (cross-tenant, read-only in MVP)
- `GET/PUT /admin/settings` (global AI provider config)

## Conversations (guard: TenantRoleGuard — agent+)
- `GET /conversations?status=&assigneeId=&mailboxId=&q=&sort=` (shipped param is `assigneeId=`)
- `GET /conversations/:id` → conversation + messages + comments
- `PATCH /conversations/:id` {status?, assigneeId?, priority?}
- `POST /conversations/:id/comments` {body} (internal note)
- `POST /conversations/:id/messages` {body, send:true} → SMTP send + store via the worker's `ot-mail-send` queue (agent+). Returns `202`-style `{data:{ok:true, deliveryKey, status:'queued'}}` — delivery is asynchronous and idempotent per `deliveryKey`; the Sent-folder copy is stored by the worker (`Message.sentCopyFolder`). `{send:false}` stores the message without delivery. Requires Redis (else `503 MAIL_QUEUE_UNAVAILABLE`).
- `POST /conversations/:id/ai-draft` → AI reply suggestion (agent+; synchronous OpenRouter call, ≤90 s) — **shipped (worker increment)**; result persisted on the conversation (`aiDraft*`) and returned as `{data:{draft:{text,sourceIds,needsHuman,model,generatedAt}, classification}}`. Drafts are never auto-sent; no knowledge sources or no usable draft → `needsHuman:true`. Inbound mail is auto-classified by the worker (`aiCategory/aiPriority/aiReason` on the conversation).

## Mailboxes (admin of tenant)
- `GET/POST /mailboxes` · `PATCH/DELETE /mailboxes/:id` (delete → 400 `MAILBOX_IN_USE` while conversations reference the mailbox)
- `POST /mailboxes/:id/verify` → IMAP/SMTP connection test (dry-run connect+auth; optional `{smtpHost?, smtpPort?, smtpSecure?}` body probes SMTP without persisting; failures → 400 `INVALID_CREDENTIALS` / `HOST_UNREACHABLE`)
(Credentials are stored encrypted (`passwordEnc`, SESSION_SECRET-derived key) and never returned in any response.)

## Knowledge base (admin of tenant)
- `GET/POST /knowledge-items` · `PATCH/DELETE /knowledge-items/:id`
- `POST /knowledge-items/reindex` → rebuild Viking collection (admin)

## Team (admin of tenant)
- `GET/POST /users` (invite; POST queues the invite e-mail when SMTP is configured — see Auth note on `setupToken`) · `PATCH /users/:id` (role, locale) · `DELETE /users/:id`

## Services (Nest modules)
`AuthModule`, `UsersModule`, `MailboxesModule`, `ConversationsModule`, `KnowledgeModule`, `KnowledgeIndexService` (ADR-0003), `PlatformAdminModule`, `ProducerModule` (BullMQ job producers; degrades without Redis), `WorkerModule` + worker services (`MailSyncService` IMAP poll, `MailSendService` SMTP send + Sent copy, `NotificationService` invite/verify mail, `AiTriageService` classify/draft; entrypoint `dist/worker/worker.js`).

## Multi-tenancy enforcement
`TenantContextMiddleware` resolves tenant from session; `TenantPrismaService` middleware injects `tenant_id` filters (ADR-0001); `TenantRoleGuard` / `PlatformAdminGuard` on controllers. Tenant models have no public unscoped repository.
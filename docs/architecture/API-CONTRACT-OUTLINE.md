# API Contract Outline — Nest.js `api` service

Status: accepted · 2026-09-12 · Part of SPEC-0001

Base URL `/v1`. All routes except `/auth/*` require a valid session cookie; tenant context is derived from the session's user. Responses: JSON, `{ data, error? }` envelope. Errors: RFC7807-style `{ code, message, details? }`.

Conventions:
- Every tenant-scoped list endpoint supports `?limit=&cursor=` cursor pagination (cursor = opaque base64 of sort key + id).
- Mutations are idempotent where side-effectful (send message: `Idempotency-Key` header honored for 24 h).
- Zod/class-validator DTOs; OpenAPI generated with `@nestjs/swagger`, served at `/v1/docs` in non-production.

## Auth
- `POST /auth/signup` {tenantName, email, password, locale} → creates tenant + owner user, sends verification
- `POST /auth/login` {email, password} → sets session cookie
- `POST /auth/logout`
- `GET /auth/me` → user, tenant, role, locale

## Platform admin (guard: PlatformAdminGuard; base `/admin`)
- `GET /admin/tenants` · `PATCH /admin/tenants/:id` (plan, suspend)
- `GET /admin/users` (cross-tenant, read-only in MVP)
- `GET/PUT /admin/settings` (global AI provider config)

## Conversations (guard: TenantRoleGuard — agent+)
- `GET /conversations?status=&assignee=&mailboxId=&q=&sort=`
- `GET /conversations/:id` → conversation + messages + comments
- `PATCH /conversations/:id` {status?, assigneeId?, priority?}
- `POST /conversations/:id/comments` {body} (internal note)
- `POST /conversations/:id/messages` {body, send:true} → SMTP send + store (agent+)
- `POST /conversations/:id/ai-draft` → AI-drafted reply (agent+; async job, returns jobId)

## Mailboxes (admin of tenant)
- `GET/POST /mailboxes` · `PATCH/DELETE /mailboxes/:id`
- `POST /mailboxes/:id/verify` → IMAP/SMTP connection test

## Knowledge base (admin of tenant)
- `GET/POST /knowledge-items` · `PATCH/DELETE /knowledge-items/:id`
- `POST /knowledge-items/reindex` → rebuild Viking collection (admin)

## Team (admin of tenant)
- `GET/POST /users` (invite) · `PATCH /users/:id` (role, locale) · `DELETE /users/:id`

## Services (Nest modules)
`AuthModule`, `TenantsModule`, `UsersModule`, `MailboxesModule`, `ConversationsModule`, `MessagesModule`, `KnowledgeModule`, `KnowledgeIndexService` (ADR-0003), `AiModule` (OpenRouter client), `PlatformAdminModule`, `MailSyncModule` (worker entrypoints: IMAP poll, SMTP send).

## Multi-tenancy enforcement
`TenantContextMiddleware` resolves tenant from session; `TenantPrismaService` middleware injects `tenant_id` filters (ADR-0001); `TenantRoleGuard` / `PlatformAdminGuard` on controllers. Tenant models have no public unscoped repository.
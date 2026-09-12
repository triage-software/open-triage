# SPEC-0001: open-triage MVP Architecture

Status: accepted · 2026-09-12 · Author: solution-architect
Depends on: ADR-0001 (multi-tenancy), ADR-0002 (auth), ADR-0003 (VikingDB), ADR-0004 (i18n)

## TLDR
open-triage MVP is an open-source, self-hostable Intercom-like shared-inbox triage product: Next.js frontend, Nest.js API backend, PostgreSQL, VikingDB as the AI knowledge base. This spec defines the target architecture the prototype in `src/` migrates toward, and the enterprise features explicitly deferred.

## Current state → target
The prototype is a single Next.js app with local-file persistence (`src/lib/store.ts`), IMAP/SMTP integration, and OpenRouter-based classification. MVP target splits persistence and AI services into a Nest.js backend backed by PostgreSQL, while Next.js becomes a pure BFF/UI layer.

```
[Browser] ──► [Next.js 16 (UI + BFF)] ──► [Nest.js API] ──► [PostgreSQL]
                                              │
                                              ├──► [VikingDB]  (KB embeddings + retrieval)
                                              ├──► [IMAP/SMTP workers]  (mail sync/send)
                                              └──► [OpenRouter]  (LLM calls: classify, draft, answer)
```

## Components

| Service | Stack | Responsibility |
|---|---|---|
| `web` | Next.js 16, React 19, Tailwind 4 | UI, auth session handling, BFF proxying `/api/*` → Nest API |
| `api` | Nest.js 11, Prisma, PostgreSQL | Domain services, REST API, tenancy enforcement, role checks |
| `db` | PostgreSQL 16 | Single physical DB, tenant-scoped rows (ADR-0001) |
| `vikingdb` | OpenViking endpoint | AI knowledge base: embeddings, semantic retrieval for drafting/classification |
| `worker` | Nest.js workers (BullMQ + Redis) | IMAP polling, SMTP send, AI classification jobs — **planned next increment; not in the shipped MVP compose** (mail/AI slice ports from the prototype layer, DR-2/DR-3) |
| `redis` | Redis 7 | Job queue for worker — shipped as dependency; **worker consumer lands next increment** |

## Multi-tenancy
See ADR-0001. Shared schema, `tenant_id` column on every tenant-owned table, enforced at two layers: Prisma middleware injects the tenant filter from the request context, and every service query goes through tenant-scoped repositories. No schema-per-tenant in MVP.

## Auth
See ADR-0002. Email+password with e-mail verification, session cookies (httpOnly, opaque session id stored server-side), OAuth (Google) optional follow-up. JWT not used for browser sessions in MVP (simpler revocation); short-lived JWT only for service-to-service if ever needed.

## Roles
Two disjoint role domains:
- **Platform roles** (super-admin): manages tenants, plans, global AI settings. Lives in a `platform_admins` table, checked by a `PlatformAdminGuard`. Separate UI surface at `/admin`, not reachable from tenant UI.
- **Tenant roles**: `owner`, `admin`, `agent`. Checked by `TenantRoleGuard` per route. Owner is the signup creator; admin manages mailboxes/team; agent works the inbox.

## Messaging / triage domain model
Core entities (PostgreSQL, Prisma):

- `Tenant` (id, name, slug, plan, createdAt)
- `User` (id, tenantId, email, passwordHash, role, locale)
- `Session` (id, userId, expiresAt)
- `Mailbox` (id, tenantId, kind=imap|channel, host, credentials encrypted at rest)
- `Conversation` (id, tenantId, mailboxId, subject, status=open|pending|resolved, assigneeId?, priority, customerEmail, lastMessageAt)
- `Message` (id, tenantId, conversationId, direction=in|out, authorType=customer|agent|ai, body, sentAt, inReplyTo)
- `Comment` (id, tenantId, conversationId, userId, body) — internal notes, never sent
- `Assignment` / status transitions recorded on `Conversation` (MVP: no event log table)
- `KnowledgeItem` (id, tenantId, title, content, source) — mirrored into VikingDB

Triage flow: inbound mail → worker parses → `Conversation` upserted by Message-ID/References thread → AI classification job (priority, intent, suggested assignee) → draft reply generated with VikingDB retrieval + conversation context → agent edits/sends → SMTP send + copy to Sent.

## i18n
See ADR-0004. English + Polish, `next-intl`, locale per user (tenant default locale field), ICU messages in `messages/{en,pl}.json`. Product strings only; tenant message content is never translated.

## Non-goals (MVP)
SSO/SAML, audit logs, advanced analytics/dashboards, SLAs, billing metering, mobile apps, public API for third parties, schema-per-tenant hosting. These return post-MVP; nothing in the data model should preclude them (tenant table has a `plan` field already).

## Hosting
Self-hostable via Docker Compose (see `docker-compose.yml` at repo root): `web`, `api`, `worker`, `db`, `redis`. EU hosting default for any managed option later (RODO/GDPR).
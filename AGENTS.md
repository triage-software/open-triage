<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Open Triage — agent instructions

An open-source customer-support platform (shared team inbox in the spirit of Intercom). Two applications live in this repository:

- **Web app (repo root)** — Next.js 16, React 19, TypeScript, Tailwind CSS 4, next-intl (English/Polish). The support panel lives at `/prototype/support`, backed by a file-based state store under `data/prototype/` (single-process, atomic writes, versioned in-place migrations). It connects to real IMAP/SMTP mail and OpenRouter for AI triage (auto-classification) and knowledge-grounded reply suggestions.
- **API service (`api/`)** — NestJS 11, Prisma 6 + PostgreSQL, BullMQ + Redis worker, argon2 auth, multi-tenancy enforced in the data layer (`TenantPrismaService` middleware, ADR-0001). Serves `/v1` under the contract in `docs/architecture/API-CONTRACT-OUTLINE.md`. The worker (`dist/worker/worker.js`) polls IMAP, sends SMTP replies with a Sent-folder copy, delivers system mail, and runs AI triage jobs.

Docker (`docker-compose.yml`) runs `db` (Postgres 16), `redis`, `api`, `worker`, and `web`; compose profiles add `vikingdb` (OpenViking placeholder, ADR-0003) and the `verify-mail` stack (Mailpit + GreenMail) used by `docs/qa/`. Architecture decisions live in `docs/architecture/ADR-*.md` — read the relevant ADR before changing auth, multi-tenancy, the knowledge index, or i18n.

## Task routing

| When the task involves… | Read first | Key rules |
|---|---|---|
| Any Next.js code (`src/app/**`, `src/components/**`) | `node_modules/next/dist/docs/` (see the Next.js block above), `README.md` | This Next.js version has breaking changes vs. older docs; verify APIs against the bundled guides. UI strings come from next-intl — add keys to both `messages/en.json` and `messages/pl.json`, and keep `node scripts/check-i18n.mjs` green. Styling is Tailwind 4 with tokens in `src/app/tokens.css`. |
| Web server data layer (`src/lib/**`) | `src/lib/store.ts`, `src/lib/types.ts` | Modules are `import "server-only"`. All state mutations go through the serialized write queue and `atomicWrite` in `store.ts` — no direct `fs` writes elsewhere. `data/prototype/state.json` is migrated in place with backups; never change its shape without a migration. Secrets (IMAP/SMTP passwords, OpenRouter key) never enter `state.json`, responses, or browser storage. |
| Web API routes (`src/app/api/**`) | `src/lib/api-response.ts`, `src/lib/api-client.ts` | Route handlers return JSON; the client (`readApiResponse`) rejects non-JSON and reads `error` as the message string. Zod parses untrusted input at the boundary. `/api/proxy/[[...path]]` forwards to the API service — keep its contract aligned with `docs/architecture/API-CONTRACT-OUTLINE.md`. |
| API service (`api/src/**`) | `docs/architecture/API-CONTRACT-OUTLINE.md`, `docs/architecture/SPEC-0001-mvp-architecture.md` | Routes live under `/v1`; everything except `/auth/*` requires a session and resolves tenant context. Responses use the `{ data }` envelope; errors are `{ code, message, details? }`; Zod validation failures are HTTP 400 via the global `ZodExceptionFilter`. Zod DTOs are parsed in controllers/services. New tenant-scoped models must go through the Prisma tenant middleware — no unscoped repositories (ADR-0001). Guards: `TenantRoleGuard`, `PlatformAdminGuard`. |
| Prisma schema & migrations (`api/prisma/**`) | `api/prisma/schema.prisma`, `docs/architecture/ADR-0001-multi-tenancy.md` | The schema is a protected surface (see `BACKWARD_COMPATIBILITY.md`). Migrations are additive; never edit an applied migration. Create them with `api/scripts/create-migration.mjs`; `migrate deploy` runs in the api container entrypoint before serving. Stored mailbox credentials are encrypted (`passwordEnc`, SESSION_SECRET-derived) and never returned by any endpoint. |
| Worker, mail & queues (`api/src/worker/**`, mail code in `src/lib/mail-*`) | `docs/architecture/API-CONTRACT-OUTLINE.md` (Services section), `README.md` | Delivery is asynchronous and idempotent per `deliveryKey`; the Sent-folder copy is stored by the worker and deduplicated by `Message-ID`. Without Redis, send endpoints answer `503 MAIL_QUEUE_UNAVAILABLE` and the producer degrades — keep those fallbacks. Never send real mail from tests; use substituted transports. |
| AI features (`src/lib/ai-*`, `api` AI triage) | `README.md` (OpenRouter section), `src/lib/ai-context.ts` | Model calls go through OpenRouter with the configured model (`z-ai/glm-5.3` default); customer emails are untrusted user content, approved knowledge is binding system context. Suggestions and classifications are validated, persisted, and invalidated by conversation/knowledge/settings changes. AI must never auto-send mail. Costs are logged locally. |
| Tests (`tests/*.test.mjs`, `api/test/*.test.ts`) | `tests/register-types.mjs`, existing tests | Both apps use the Node.js built-in test runner (web: `node --test`, api: `node --import tsx --test`). New behavior ships with regression tests; mail and AI tests use fakes and temp directories — hermetic, no network. |
| i18n (`messages/`, `src/i18n/`) | `messages/en.json`, `src/i18n/request.ts`, `scripts/check-i18n.mjs` | Every user-facing string lives in both locales under matching namespaces; `scripts/check-i18n.mjs` is the gate. Locales: `en`, `pl` (ADR-0004). |
| Docker & deployment (`Dockerfile`, `api/Dockerfile`, `docker-compose.yml`) | `docs/architecture/DOCKER-COMPOSE-TOPOLOGY.md` | The api container runs `prisma migrate deploy` before serving; the worker reuses the api image. Compose profiles (`with-vikingdb`, `verify-mail`) stay out of the default stack. Environment variables are documented in `.env.example`. |
| Architecture decisions (`docs/architecture/**`) | the relevant `ADR-*.md` | Changing auth, multi-tenancy, knowledge indexing, or i18n approach requires updating the corresponding ADR in the same PR. |

## Validation

The full gate (both applications) — run before every PR, in this order:

```sh
npm run typecheck
npm test
npm run build
npm --prefix api run typecheck
npm --prefix api test
npm --prefix api run build
```

The authoritative list lives in `.ai/agentic.config.json` (`validation.commands`); keep it in sync with `SDLC.md`.

## Process documents

- `SDLC.md` — ticket flow, label state machine, QA gate, claim protocol.
- `CODE_REVIEW.md` — review rules applied by reviewers and `ot-code-review`.
- `BACKWARD_COMPATIBILITY.md` — protected contract surfaces and how to change them.
- `.ai/agentic.config.json` — pipeline configuration (tracker, browser, labels, gate).

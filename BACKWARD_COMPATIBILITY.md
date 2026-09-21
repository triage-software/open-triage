# Backward compatibility — protected contract surfaces

What this repository treats as a protected contract, what counts as a breaking change to it, and the required path for changing it. Review skills (`ot-code-review`, `ot-auto-review-pr`) check every PR against this file; implementation skills (`ot-fix`, `ot-auto-create-pr`, `ot-auto-implement-spec`, …) must warn the user when a planned change violates it.

Surfaces were inventoried from the code on 2026-09-21. When a new one appears (a public module export consumed across apps, a new persisted format, a new published endpoint), add it here in the same PR.

## 1. API service HTTP surface — `/v1` (`api/src/**`)

The contract is documented in `docs/architecture/API-CONTRACT-OUTLINE.md` (status: accepted, part of SPEC-0001). The web app consumes it server-to-server through the BFF proxy (`src/app/api/proxy/[[...path]]/route.ts`) and directly during local dev.

**Protected:** route paths and methods under `/v1`; the `{ data }` response envelope; the error shape `{ code, message, details? }` and the specific error codes clients branch on (`VALIDATION_ERROR`, `MAIL_QUEUE_UNAVAILABLE`, `INVALID_CREDENTIALS`, `HOST_UNREACHABLE`, `MAILBOX_IN_USE`); request/response field names (`assigneeId`, `aiDraft*`, `deliveryKey`, `sentCopyFolder`, …); auth semantics (session cookie, `setupToken` fallback when system SMTP is absent).

**Breaking:** removing or renaming a route, field, or error code; changing a field's meaning or type; making a previously optional input required; changing auth cookie behavior.

**Required path:** prefer additive evolution (new optional fields, new routes). For a genuine break: update `API-CONTRACT-OUTLINE.md` and the affected web callers in the same PR, name the break in the PR body, and tag the PR `risk-high` + `needs-qa`. Cursor pagination on tenant-scoped lists and `Idempotency-Key` headers are reserved post-MVP additions — do not ship a conflicting shape silently.

## 2. Database schema and migrations (`api/prisma/**`)

Models: `Tenant`, `PlatformAdmin`, `GlobalSetting`, `User`, `Session`, `TenantSetting`, `Mailbox`, `Conversation`, `Message`, `Comment`, `ConversationDraft`, `Notification`, `KnowledgeItem`, `KnowledgeItemVersion` plus their enums (`Role`, `Plan`, `ConversationStatus`, `Priority`, `Direction`, `AuthorType`, `MailboxKind`).

**Protected:** existing tables, columns, enums, and the tenant-scoping invariants of ADR-0001 (`tenant_id` filtering through `TenantPrismaService`).

**Breaking:** dropping or renaming columns/tables, narrowing types, removing enum members with stored rows, any migration that orphans tenant-scoped rows, or editing an already-applied migration.

**Required path:** additive migrations only (add table/column/enum member, backfill, then a separate removal PR once no code reads the old shape). Create migrations with `api/scripts/create-migration.mjs`; the api container runs `prisma migrate deploy` before serving, so every migration must be safe to run against a populated database at startup. Regenerate the client (`npm --prefix api run generate`) and update `API-CONTRACT-OUTLINE.md` when the change is visible over HTTP.

## 3. Prototype on-disk state — `data/prototype/**` (web app)

`state.json` is the single source of state, written by the serialized queue in `src/lib/store.ts` with atomic rename. Related layout: `settings/openrouter.json` (0600), `mail/<uid-validity>/<uid>.eml`, `generations/<generation>/knowledge/.../vN.md` and `archives/...-vN.md`, `backups/` for pre-migration copies.

**Protected:** the `DemoState` shape and its versioned migration chain (`migrateMailboxes`, `migrateTeam`, `removeSampleMail`, …); the guarantee that a version change backs up the previous file and that missing Markdown files are restored from state on boot; the 0600 permission on the OpenRouter key file.

**Breaking:** changing a persisted field's name/type without a migration, writing state outside `atomicWrite`, making the loader reject an older file, or dropping the backup step.

**Required path:** add an in-place migration to the loader chain (pattern: detect old shape → migrate → write backup to `data/prototype/backups/<generation>-before-<name>.json`), keep the loader tolerant of every older shape still in the wild, and cover it in `tests/`. This format is local to one machine, so there is no deprecation window — but there must be no update that loses team data.

## 4. Web BFF routes — `src/app/api/**` (Next.js route handlers)

`/api/ai/classification`, `/api/ai/suggestion`, `/api/settings/ai` (+ `models`, `test`, `usage`), `/api/settings/signatures`, `/api/mail/source`, `/api/mail/sync`, `/api/demo`, `/api/dev/react-grab`, `/api/proxy/[[...path]]` — consumed by `src/lib/api-client.ts`.

**Protected:** route paths, request/response JSON shapes, and the client's contract in `readApiResponse`: responses are `application/json`; failures carry a string `error` field used as the user-facing message; non-JSON is rejected with a server/proxy diagnostic.

**Breaking:** removing/renaming a route, changing a response shape the panel reads, returning HTML error pages, or changing the `error` contract.

**Required path:** additive first; for a break, update `api-client.ts` and all call sites in the same PR and tag `risk-medium` or higher with `needs-qa` when the panel flow changes.

## 5. i18n message keys — `messages/en.json`, `messages/pl.json`

Every user-visible string is resolved through next-intl (ADR-0004); `scripts/check-i18n.mjs` is the enforcement gate.

**Protected:** existing keys and namespaces (e.g. `auth.*`) in both locales.

**Breaking:** removing or renaming a key still referenced by a component, or letting the two locales diverge (missing translation is a review finding, not a build failure).

**Required path:** add new keys to **both** locales in the same PR; run `node scripts/check-i18n.mjs`. Renames require updating all call sites plus both files at once.

## 6. Environment variables — `.env.example`, `docker-compose.yml`, README

Required: `SESSION_SECRET`, `POSTGRES_PASSWORD` (compose defaults). Optional but load-bearing: `DATABASE_URL`, `REDIS_URL`, `API_URL`, `APP_URL`, `VIKINGDB_URL`, `OPENROUTER_API_KEY`, `API_PORT`, `WORKER_POLL_INTERVAL_MS`, `SMTP_SYSTEM_*` (system mail; empty keeps the MVP `setupToken`/server-log fallback), `WEB_PORT`, `MAILPIT_UI_PORT`, `GREENMAIL_*` (verify profile). The web prototype additionally reads its mail/SMTP config from `.env.local` (`TRIAGE_*` variables documented in the README, server-side only).

**Protected:** variable names and their documented fallbacks (empty `SMTP_SYSTEM_HOST` ⇒ token-in-response fallback; empty `TRIAGE_SMTP_PASSWORD` ⇒ reuse IMAP password; `VIKINGDB_URL` unreachable ⇒ graceful degradation).

**Breaking:** removing/renaming a variable without a compose + `.env.example` + README update, or changing a documented default's meaning.

**Required path:** keep `.env.example`, `docker-compose.yml`, and the README in sync in the same PR; never introduce a variable that is required for `docker compose up` but absent from `.env.example`.

## 7. Docker compose topology — `docker-compose.yml`

Services `db`, `redis`, `api`, `worker`, `web` (default profile); `vikingdb` under `with-vikingdb`; `mailpit` + `greenmail` under `verify-mail`, consumed by `docs/qa/e2e.sh` and `docs/qa/mailboxes-smoke.sh`. The api entrypoint runs `prisma migrate deploy` before `node dist/main.js`; the worker is the same image with a different entrypoint and must never run migrations.

**Protected:** service names, ports (`WEB_PORT`→3000, `API_PORT`→4000, Postgres 5432, Mailpit UI 8025, GreenMail 3143/3025), health checks the `depends_on` conditions rely on, and the migrations-before-serving rule.

**Breaking:** renaming a service or profile the QA scripts and docs reference, moving migrations into the worker, or breaking a health check that gates startup order.

**Required path:** update `docs/architecture/DOCKER-COMPOSE-TOPOLOGY.md`, the QA scripts, and this file in the same PR; run the `verify-mail` profile scripts when mail wiring changes.

## 8. Outgoing-mail behavior (MIME-level guarantees, README-documented)

Shared `From`/`Reply-To` (the mailbox address, not the individual staff member); threading via `Message-ID`/`In-Reply-To`/`References`; exactly-once intent for the Sent-folder copy (dedup by `Message-ID`, including FETCH-header checks); uncertain-send state blocks further sends in a conversation until resolved; persistent outbox log in `state.json` not exposed in public state; internal comments never reach the outgoing message.

**Protected:** all of the above — these are promises other mail clients and the team rely on, not implementation details.

**Breaking:** any change to sender identity, threading headers, dedup logic, or the uncertain-send state machine.

**Required path:** an ADR in `docs/architecture/` describing the new guarantee and its migration, regression tests in `tests/` (substituted transports only), `risk-high` + `needs-qa` on the PR, and a manual verification note (the README's verification section is the precedent).

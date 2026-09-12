# Docker Compose topology — open-triage

Status: accepted · 2026-09-12 · Part of SPEC-0001 · **worker increment shipped (t_87a44da4, 2026-09-12): `worker` service now in the default stack (DR-3 resolved).**

Local/self-host topology (repo root `docker-compose.yml`):

| Service | Image / build | Ports | Notes |
|---|---|---|---|
| `web` | build `./` (Next.js) | 3000 | UI + BFF; talks to `api` over internal network |
| `api` | build `./api` (Nest.js) | 4000 (internal; expose only for dev) | REST `/v1`, Prisma, guards, job producers |
| `worker` | build `./api` (same image, `node dist/worker/worker.js`) | — | BullMQ consumers: IMAP poll (BATCH 20), SMTP send + Sent copy, invite/verification mail, AI classify/draft; repeatable `poll-all-scheduler` every `WORKER_POLL_INTERVAL_MS` (default 30 s) |
| `db` | `postgres:16-alpine` | 5432 (dev only) | single volume `pgdata`; migrations via `api` on start |
| `redis` | `redis:7-alpine` | — | job queue backend (BullMQ); `api`+`worker` require it healthy |
| `vikingdb` | OpenViking endpoint image or external URL | 1933 | per ADR-0003; `VIKINGDB_URL` env |
| `mailpit` (profile `verify-mail`) | `axllent/mailpit` | 8025 (UI) | SMTP sink for E2E mail scenarios |
| `greenmail` (profile `verify-mail`) | `greenmail/standalone` | 3143 (IMAP), 3025 (SMTP) | IMAP source for E2E mail scenarios |

Environment contract (`.env.example`): `DATABASE_URL`, `REDIS_URL`, `VIKINGDB_URL`, `OPENROUTER_API_KEY`, `SESSION_SECRET`, `APP_URL`, `WORKER_POLL_INTERVAL_MS` (optional, default 30000), `SMTP_SYSTEM_HOST`/`SMTP_SYSTEM_PORT`/`SMTP_SYSTEM_USER`/`SMTP_SYSTEM_PASSWORD`/`SMTP_SYSTEM_FROM` (optional system-mail transport; absent → invite/verify mails fall back to the MVP in-app/log tokens). Mail credentials per mailbox entered in-app (stored encrypted with `SESSION_SECRET`-derived key).

Worker queues: `ot-mail-sync` (IMAP poll per mailbox, UIDVALIDITY/lastUid cursor on `Mailbox`), `ot-mail-send` (`send-reply` idempotent by `Message.deliveryKey`, `sent-copy` retried separately), `ot-notification` (invite/verify mail), `ot-ai` (classify auto-triggered on inbound, draft via `POST /conversations/:id/ai-draft`). Without `REDIS_URL` producers degrade to the MVP fallbacks (setupToken in invite response, verify token in server logs).

Rules:
- `web` is the only service with a published port in production-style local hosting; `db`/`redis` ports published only in the dev override (`docker-compose.override.yml`).
- Migrations run by `api` before serving (`prisma migrate deploy`); no manual db exec. The `worker` starts only after `api` is healthy, so the schema is always migrated first.
- Volumes: `pgdata` only. Mail credentials live in DB (encrypted), not compose env.
- Healthchecks: `web`/`api` HTTP `/healthz`, `db` `pg_isready`, `redis` `PING`. The worker has no HTTP surface; `restart: unless-stopped` + `depends_on` guard it.
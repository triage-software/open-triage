# Docker Compose topology — open-triage MVP

Status: accepted · 2026-09-12 · Part of SPEC-0001

Local/self-host topology (repo root `docker-compose.yml` to be implemented with the backend):

| Service | Image / build | Ports | Notes |
|---|---|---|---|
| `web` | build `./` (Next.js) | 3000 | UI + BFF; talks to `api` over internal network |
| `api` | build `./api` (Nest.js) | 4000 (internal; expose only for dev) | REST `/v1`, Prisma, guards |
| `worker` | build `./api` (same image, `worker` entrypoint) — **planned next increment, not in shipped compose (DR-3)** | BullMQ consumer: IMAP poll, SMTP send, AI classify/draft |
| `db` | `postgres:16-alpine` | 5432 (dev only) | single volume `pgdata`; migrations via `api` on start |
| `redis` | `redis:7-alpine` | — | job queue backend |
| `vikingdb` | OpenViking endpoint image or external URL | 1933 | per ADR-0003; `VIKINGDB_URL` env |

Environment contract (`.env.example`): `DATABASE_URL`, `REDIS_URL`, `VIKINGDB_URL`, `OPENROUTER_API_KEY`, `SESSION_SECRET`, `APP_URL`, mail credentials per mailbox entered in-app (stored encrypted with `SESSION_SECRET`-derived key).

Rules:
- `web` is the only service with a published port in production-style local hosting; `db`/`redis` ports published only in the dev override (`docker-compose.override.yml`).
- Migrations run by `api` before serving (`prisma migrate deploy`); no manual db exec.
- Volumes: `pgdata` only. Mail credentials live in DB (encrypted), not compose env.
- Healthchecks: `web`/`api` HTTP `/healthz`, `db` `pg_isready`, `redis` `PING`.
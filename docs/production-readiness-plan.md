# Production Readiness Plan: PostgreSQL, S3, and a Stateless Application

**Status: draft — still being refined.**

Written on: 2026-09-04. The description of the current state is based on a code review from 2026-09-03, at revision `eb4b235`.

This document records the direction agreed on during a conversation. It does not signify production readiness or approval to implement the migration or deployment. For now we are continuing to refine the application locally; migration and production require a separate decision. Committing this document to `main` does not trigger any of the actions described here.

## 1. How data is stored today

Today this is a local file store, meant for a single process, not a database.

| Data | Current location | Target location |
| --- | --- | --- |
| Conversations, email content, comments, assignments, drafts, notifications, signatures | `data/prototype/state.json` | PostgreSQL tables |
| Knowledge base with version history and conversation archives | `state.json` plus `.md` copies | PostgreSQL; Markdown as export |
| Originals of received emails with attachments | `.eml` files | Private S3 bucket |
| Originals of sent emails | Base64 inside `outbox` in JSON | S3; reference in PostgreSQL |
| IMAP cursor, send log, idempotency, AI results and costs | `state.json` | PostgreSQL |
| OpenRouter model and API key | Separate `data/prototype/settings/openrouter.json` | PostgreSQL, key encrypted |
| Employee presence and operation coordination | Process memory | PostgreSQL |
| Selected employee | Browser `sessionStorage`, no login | Google identity and session in PostgreSQL |

Every operation reads the entire JSON file, and every change writes the whole file via a temporary file and `rename`. The in-memory queue only serializes operations within a single process. Markdown is a copy of the data, not an independent source of truth. Simply replacing the file with a single JSONB column does not solve the multiple-replica problem.

Sources in the repository: [state store](../src/lib/store.ts), [MIME storage and sync](../src/lib/mail-sync.ts), [AI settings](../src/lib/ai-settings-store.ts).

## 2. Target division of responsibilities

PostgreSQL will be the application's source of truth. S3 will be the store for original messages. The application pod will hold no persistent state; PostgreSQL and object storage remain the stateful services.

- Separate records for conversations, messages, comments, drafts, knowledge versions, archives, notifications, operations, and settings. Text content stays in the database; JSONB is used only for complex snapshots, e.g. the signature captured at send time and AI sources.
- Knowledge base content and archives stay in PostgreSQL as versioned text. We do not maintain additional `.md` copies on disk or in S3; export happens on demand.
- S3 stores immutable incoming and outgoing MIME. We are not splitting out attachments in this iteration — they are already part of the MIME.
- The database stores the object key, size, and SHA-256. The bucket is private; retrieval goes through an authenticated API.
- Import: MIME is written to S3 first, then a single transaction saves the message and the IMAP cursor. A database failure may leave behind an unused object, but we will not confirm an import without the original.
- Access layer: `pg` with versioned SQL migrations; an S3 client via the AWS SDK with a configurable endpoint. No application dependency on AWS or Kubernetes.

## 3. Statelessness and coordination independent of K8s

One application image, two independent run modes:

- **Web:** Next.js, UI, authentication, and API.
- **Worker:** IMAP sync, SMTP sending, retrying "Sent" copies, and AI generation.

The worker will be a plain Node process, runnable in Docker Compose as well as outside a container. We are removing sync execution from every Next.js server.

Coordination happens in PostgreSQL:

- Short transactions claim jobs via `FOR UPDATE SKIP LOCKED`; network operations run outside the transaction. This is also the mechanism intended for multiple queue consumers. [PostgreSQL documentation](https://www.postgresql.org/docs/current/sql-select.html)
- Jobs have a next-attempt deadline, an owner, a claim token, and an expiring lease. An old worker cannot commit a result after losing its claim on a job.
- Uniqueness constraints protect operation identifiers, IMAP message IDs, and the active send for a conversation. Draft, conversation, and document versions keep their current conflict control.
- Restarting one process does not interrupt operations belonging to other processes. We are replacing the current global send-recovery mechanism with handling of expired leases.
- We do not automatically retry an uncertain SMTP outcome. A failure writing the IMAP copy only retries the copy. An uncertain, paid AI generation is likewise not repeated without a deliberate user decision.
- We record presence as a heartbeat in PostgreSQL, with the current 45-second expiry. A harmless in-memory model-catalog cache may stay in RAM.

Redis is not needed in the first version. We also do not need Kubernetes Lease, sticky sessions, or a PVC for the application.

### API contract changes

Sending, AI generation, and manual sync will return `202` with an `operationId`; the UI will read operation status through the API. "Queued" will not be presented as "sent." Other operations keep version control and server-side conflict resolution.

## 4. Public access and secrets

The agreed target of access over the public Internet requires real login. The current employee selector is not authentication, and the storage migration alone is not enough to safely expose the prototype.

- Google OAuth via Better Auth, sessions in PostgreSQL, no custom passwords. Access only for verified addresses on a required allowlist; an empty list admits no one. [Google](https://better-auth.com/docs/authentication/google), [validating identity before login](https://better-auth.com/docs/concepts/oauth)
- A single permission level: every admitted employee has access to all mailboxes and settings, including changing the AI key.
- We remove the ability to impersonate someone via the employee selector. The operation author and draft owner come from the session, not from a submitted `userId`.
- All data, files, and operations require a session. Cookies: `HttpOnly`, `Secure`, `SameSite`; request-origin validation stays in place.
- We still edit the OpenRouter key in the UI. The database stores an AES-256-GCM ciphertext with a key identifier; the encryption key is supplied from outside the database via secrets configuration. The API returns only a "configured" status, never the secret.
- PostgreSQL/S3, Google, and IMAP/SMTP credentials likewise remain environment secrets. A copy of the encryption key is necessary to recover encrypted settings.

## 5. Rollout, deployment, and acceptance criteria

Agreed decisions: a clean start, new messages only, Google, equal permissions, and coordination through PostgreSQL. The actions below are a plan for later, not tasks triggered by committing this document.

- We do not import the local JSON or `.eml` files; existing files remain untouched.
- On first connection we record `UIDVALIDITY` and `UIDNEXT - 1` as the starting point. Subsequent runs continue from the saved cursor. A change in `UIDVALIDITY` halts sync pending a deliberate re-establishment of the starting point.
- At launch, the current test-mailbox integration remains; connecting additional mailboxes is not part of this migration.
- Migrations run as a separate command before rollout. Web and worker may have multiple replicas; containers require no persistent filesystem. Any `/tmp` or Next.js cache is ephemeral.
- Before making this available, the following are required: an HTTPS domain, Google configuration, the allowlist, secrets, and a verified PostgreSQL and S3 backup/restore process.

### Acceptance tests before a production decision

- [ ] Two web replicas and two workers: no lost changes and no duplicate operations.
- [ ] An S3 failure does not advance the IMAP cursor; a restart does not re-fetch old mail.
- [ ] An interrupted send preserves the uncertain state; retrying the copy does not trigger SMTP.
- [ ] Draft and knowledge-base conflicts still work; concurrent AI generation shares the operation.
- [ ] Sessions work across replicas; an anonymous or non-admitted user cannot read mail, files, or settings.
- [ ] Deleting and recreating all application pods causes no data loss.

Carrying out and validating the tests above requires separate verification. No item is confirmed merely by this plan's existence.

# Password recovery: local setup and checks

The authenticated application exposes `/sign-in`, `/forgot-password` and
`/reset-password`. This flow uses the Nest API, PostgreSQL, Redis and the mail
worker. It is separate from the file-backed prototype.

## Local mail delivery

Use a local Mailpit sink to inspect recovery mail without delivering to real
recipients. With the API and worker running on the host, example loopback-only
containers are:

```sh
docker run --detach --rm --name open-triage-reset-redis --publish 127.0.0.1:16379:6379 redis:7-alpine
docker run --detach --rm --name open-triage-reset-mailpit --publish 127.0.0.1:18025:8025 --publish 127.0.0.1:11025:1025 axllent/mailpit:latest
```

Reuse healthy local services if these names or ports are already occupied.
Provide these settings to **both API and worker**, alongside the existing
`DATABASE_URL` and `SESSION_SECRET` used by the local authenticated application:

```dotenv
REDIS_URL=redis://127.0.0.1:16379
APP_URL=http://127.0.0.1:3000
SMTP_SYSTEM_HOST=127.0.0.1
SMTP_SYSTEM_PORT=11025
SMTP_SYSTEM_SECURE=false
SMTP_SYSTEM_USER=
SMTP_SYSTEM_PASSWORD=
SMTP_SYSTEM_FROM=recovery@example.test
```

Set the frontend's `API_URL=http://127.0.0.1:4000`. Ensure the configured local
environment is loaded into each process, then generate Prisma, apply migrations
and build the API:

```sh
npm --prefix api run generate
npm --prefix api run migrate:deploy
npm --prefix api run build
```

Run the API (`npm --prefix api start`), worker
(`npm --prefix api run start:worker`) and frontend (`npm run dev`) in separate
terminals with that environment. Native API/worker commands read process
environment variables; they do not automatically load the frontend's
`.env.local`. Mailpit's inbox is at <http://127.0.0.1:18025>.

For the existing Compose `verify-mail` profile, services resolve Redis as
`redis:6379` and Mailpit as `mailpit:1025`; `APP_URL` must still use the URL opened
by the browser. The API and worker receive `SMTP_SYSTEM_*` through Compose.
Do not put `127.0.0.1` in their SMTP host when Mailpit is another container.

If mail delivery is unconfigured, the reset form reports unavailability. An
accepted request confirms neither that an account exists nor that mail arrived;
check Mailpit and the worker when troubleshooting. Queue failures do not expose
a reset token through an API response or logs.

## Automated checks

Install root/API dependencies first. The database-backed regression command is:

```sh
npm --prefix api run generate
npm --prefix api run test:integration
```

It requires a running Docker daemon, creates a disposable `postgres:16-alpine`
container on a randomly allocated loopback port with tmpfs storage, applies the
repository migrations, and executes the integration tests against real Prisma,
PostgreSQL and Argon2. The harness creates its own database credentials and
session secret and removes the container in `finally`; it does not use or reset
the development database. Missing Docker or a failed migration is a failure,
not a skipped test. Mail enqueueing is substituted in this suite, so real
Redis/SMTP delivery still needs the browser check below.

The full project gate is listed in
[`.ai/agentic.config.json`](../../.ai/agentic.config.json). Root tests cover the
frontend actions; API unit tests cover mail composition and enqueue behavior.

## Local HTTP and mail smoke test

With the local API, Redis, worker and Mailpit running as above, execute:

```sh
RESET_SMOKE_API_ORIGIN=http://127.0.0.1:4000 RESET_SMOKE_MAILPIT_ORIGIN=http://127.0.0.1:18025 node docs/qa/password-reset-smoke.mjs
```

Those origins are the defaults; overrides must use loopback addresses. The
script creates a unique synthetic `.test` account, holds random credentials in
memory and retrieves only its own Mailpit message. It exercises the real HTTP,
Redis, worker and SMTP path, checking the generic response for known and unknown
addresses, the delivered reset link, old-password and old-session rejection,
new-password login and single use of the token. It does not print or save the
credentials or reset URL.

The script leaves its own synthetic account and mail in the local environment.
It complements the database integration suite (which substitutes mail enqueueing)
and the browser checklist; passing it does not establish that the UI works or
that production mail delivery is configured.

## Browser checklist

These are verification steps, not a record of a completed run. Use disposable
local accounts and record outcomes separately without passwords or reset URLs.

1. On `/sign-in`, follow “Forgot password?” and request a link for a test account.
   Confirm the same generic response for an unknown address. Another request
   within 60 seconds should not produce an extra email.
2. Open the Mailpit message, confirm its account name and follow its link. For
   an address present in several workspaces, inspect each separate account link.
3. Check a short password and mismatched confirmation, then save a valid new
   password. Sign in with it; the old password and an earlier session must fail.
4. Reopen the consumed link and check an invalid or expired link. Both must
   offer a route to request another link without changing the password.
5. Check English and Polish text, pending state, keyboard form controls and
   error feedback. With mail configuration absent, verify the unavailable state.

After a manually started local QA session, stop only its owned containers:

```sh
docker rm --force open-triage-reset-mailpit open-triage-reset-redis
```

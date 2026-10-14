# Code review: password recovery and authentication

## Verdict

**approve** — the local implementation passes the configured gate; no unresolved actionable findings remain in the reviewed changes. This is a local review, not a deployment or remote CI result.

## Summary

Users and platform administrators can request a recovery email, set a new password with a single-use link valid for 30 minutes, and invalidate their prior sessions. Separate workspace memberships retain separate credentials. The earlier same-email login selection bug is also covered.

The independent review found a login/reset race; real PostgreSQL tests reproduced it for users and administrators before the credential-row transaction fix. Another real-database regression reproduced underscore wildcard matching in case-insensitive email lookup; literal escaping fixed it. Both findings were re-reviewed as resolved.

## Validation Gate

Executed in the configured order on 2026-09-25. Local command logs are in the ignored `artifacts/password-reset-validation/` directory.

| Command | Status | Evidence |
|---|---|---|
| `npm --prefix api run generate` | PASS | Prisma client generated |
| `npm run typecheck` | PASS | Frontend TypeScript |
| `npm test` | PASS | 59 tests |
| `npm --prefix api run typecheck` | PASS | API TypeScript |
| `npm --prefix api test` | PASS | 53 tests |
| `npm --prefix api run test:integration` | PASS | 15 tests on disposable PostgreSQL; no skips |
| `npm --prefix api run build` | PASS | API and worker compiled |
| `npm run build` | PASS | Production Next build, including both recovery routes |

## Touched contracts

The two public recovery endpoints and optional database fields are additive. Apply the scoped migration before starting the updated API/worker. Mail delivery requires Redis, the worker, system SMTP configuration and a browser-accessible APP_URL; missing configuration returns RESET_UNAVAILABLE equally for known and unknown addresses. Reset tokens are stored as digests in PostgreSQL and removed from queue history on completion/final failure. Existing cookies, login response shapes and invite/verification flows remain compatible.

Recovery requests use a 60-second per-account database cooldown. Token consumption, password replacement and session revocation commit atomically. Login serializes session creation with reset on the same credential row. Accounts are looked up by literal mailbox and links authorize only their target principal. Pages retain server-rendered shells with a small form component and no new runtime dependency.

## Test Coverage

Native tests cover frontend validation/error mapping, mail composition/queue failure, existing authentication, concurrent reset requests/consumption, blocked accounts, workspace isolation, administrator recovery, expiry/reuse and login/reset races. A separate live HTTP/SMTP smoke passed through the actual Redis/worker/Mailpit path. Browser observations and their limits are recorded in [the QA report](../qa/password-reset-2026-09-25.md).

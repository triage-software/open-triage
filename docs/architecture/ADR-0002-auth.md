# ADR-0002: Session-cookie auth, email+password first

Status: accepted · 2026-09-12
Part of: SPEC-0001

## Context
MVP needs sign-in for tenant users and a super-admin. Self-hostable, no cloud identity provider dependency, EU-friendly (RODO: minimal third-party data sharing).

## Options
1. **Own email+password + server-side sessions in httpOnly cookies** — full control, no external dependency, simple revocation (delete session row).
2. **JWT access+refresh tokens in localStorage** — stateless, but revocation needs a denylist anyway (state again), and token-in-JS storage is XSS-prone.
3. **Auth library (NextAuth/Auth.js or Lucia)** — faster to build, but its session model still needs our tenant-role wiring; adds an upgrade risk with Next 16.
4. **OAuth-only (Google etc.)** — good UX but forces users to have providers; bad fit for self-hosted installs behind firewalls.

## Decision
Option 1, hand-rolled minimal: `Session` table (opaque 256-bit id, userId, expiresAt, rotated on login), cookie `ot_session` httpOnly+Secure+SameSite=Lax. Passwords hashed with argon2id. E-mail verification token on signup. OAuth (Google) may be added later as an *additional* factor — the session table stays the anchor. Platform admins authenticate the same way; authorization differs by role check (SPEC-0001).

## Consequences
- Sessions require a DB lookup per request — acceptable; enables instant logout-everywhere and role changes taking effect immediately.
- No third-party auth data flows — simplest RODO story for self-host.
- CSRF: SameSite=Lax + same-origin BFF calls; add a token only if we later accept cross-origin browser clients.

## Password recovery

Added 2026-09-25. The sign-in page links to `/forgot-password`; recovery uses an
email link to `/reset-password?token=…`, followed by a new sign-in. The API accepts
an email address (trimmed, at most 254 characters), finds eligible accounts
without case sensitivity, and sends separate links with the workspace name or
platform-administration label when an address belongs to several accounts.
Deactivated users, suspended tenants and unaccepted invitations are ineligible.
Resetting one account does not change the other accounts' passwords or sessions.

Each token contains 256 random bits, expires 30 minutes after issuance, and can
be used once. PostgreSQL stores its SHA-256 digest, expiry and request time;
the raw token is needed only in the queued mail payload and link, never in an
API response or application log. An atomic per-account 60-second cooldown
prevents concurrent requests from sending several links. Issuing a later link
replaces the previous one. Argon2id hashes the new 10–200-character password.
Consuming the token, updating the hash and deleting the account's sessions form
one transaction. Login also checks the current hash when creating its session,
so a login already verifying the old password cannot survive the reset.

Known, unknown and ineligible addresses receive the same `200 {ok:true}` body.
Missing queue or system SMTP configuration returns `503 RESET_UNAVAILABLE`
before account lookup; there is no recovery-token fallback. Failure to enqueue
invalidates only that request's token and permits a retry, while preserving the
same response. The worker retries delivery up to three times and removes the
secret-bearing job after completion or final failure. An accepted request is
not proof of delivery. API and worker need the same Redis and SMTP settings;
`APP_URL` determines the link's trusted origin, independent of request headers.

See the [API contract](API-CONTRACT-OUTLINE.md#auth) and
[local setup and checks](../qa/password-reset.md).

## Reversal trigger
If SSO/SAML demand arrives (enterprise tier), introduce an IdP bridge in front of the same session model — do not replace sessions.
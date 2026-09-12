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

## Reversal trigger
If SSO/SAML demand arrives (enterprise tier), introduce an IdP bridge in front of the same session model — do not replace sessions.
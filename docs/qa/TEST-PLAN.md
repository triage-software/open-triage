# QA Test Plan — open-triage MVP (SPEC-0001)

Spec: `docs/architecture/SPEC-0001-mvp-architecture.md` + ADR-0001..0004 + API-CONTRACT-OUTLINE.
Code under test: commit `f062a14`, branch `rebrand/design-system`.
Environment: Docker Compose stack (`db`, `redis`, `api`, `web`), web on http://localhost:3000, api internal :4000 via BFF `/api/*` proxy.
Depth: MVP — smoke + API integration on data/auth/tenancy paths.

## Criterion → check mapping

| # | Criterion (source) | Check type | How to execute | Data needed |
|---|---|---|---|---|
| AC-1 | Docker Compose bring-up: db/redis/api/web healthy, migrations on api start (compose topology doc) | API integration | `docker compose ps`, `/healthz`, `GET /sign-in` 200 | — |
| AC-2 | Signup creates tenant + owner, session cookie set (SPEC Auth, API `/auth/signup`) | API integration | POST /api/auth/signup → 201, `ot_session` cookie, `/auth/me` returns owner | fresh email |
| AC-3 | Login/logout with instant revocation (ADR-0002) | API integration | login → cookie; logout → session row deleted; reused cookie → 401 | AC-2 user |
| AC-4 | Password policy: min 10 chars; argon2id hash stored (ADR-0002) | API integration + DB check | signup with 9-char pw → 400; check hash prefix in DB | — |
| AC-5 | Session cookie is httpOnly + SameSite=Lax, signed HMAC (ADR-0002) | API integration | inspect Set-Cookie attributes; tampered cookie value → 401 | AC-2 session |
| AC-6 | Email verification token issued on signup; POST /auth/verify flips emailVerified (ADR-0002) | API integration | signup → grab token from api logs → verify → me shows emailVerified true | api container logs |
| AC-7 | Tenant isolation: user of tenant A cannot read tenant B conversation/knowledge (404 NOT_FOUND), lists scoped (ADR-0001 — negative test) | API integration | seed 2 tenants; cross-tenant GET on conversation & knowledge id → 404; list shows only own | 2 tenants + seeded rows |
| AC-8 | Role guard: agent cannot use admin-only endpoints (users/knowledge POST) (SPEC roles, TenantRoleGuard) | API integration | invite agent, login as agent → POST /users → 403; GET /users → 403 | AC-7 tenant |
| AC-9 | Platform admin: login, /admin/* works; tenant user on /admin → 403 (PlatformAdminGuard) | API integration | create-platform-admin script → login → GET /admin/tenants; tenant cookie on /admin/tenants → 403 | admin creds |
| AC-10 | Super-admin tenant management: PATCH plan + suspend; suspended tenant login → TENANT_SUSPENDED (SPEC, admin UI) | API integration | PATCH tenants/:id suspended=true → owner login → 401 TENANT_SUSPENDED; existing session rejected; un-suspend restores | AC-7 tenant A |
| AC-11 | Super-admin global AI settings GET/PUT persisted (API contract) | API integration | PUT /admin/settings → GET returns value | admin |
| AC-12 | Conversations CRUD: list/detail/patch status & priority, comments (API contract) | API integration | seed conversation via DB, exercise endpoints | AC-7 tenant A |
| AC-13 | Knowledge base: create/list/patch/delete; reindex degrades gracefully when VikingDB unreachable (ADR-0003) | API integration | POST/GET/DELETE /knowledge-items; POST reindex → 200 with degraded flag; api log warn, no 5xx | AC-7 tenant A |
| AC-14 | Knowledge index per-tenant collections (`tenant-{id}`) — no cross-tenant index reuse (ADR-0003) | Code review + API | collection naming review; two tenants same item id → separate collections | code |
| AC-15 | en/pl i18n: locale from `ot_locale` cookie, no [locale] URL segment, pl catalog complete (ADR-0004) | UI/API | curl pages with ot_locale=pl → Polish strings; en default; messages files key parity | — |
| AC-16 | Tenant content never machine-translated; Polish chars (ąćęłńóśźż) round-trip in tenantName, conversation subject, comment, KB item | API integration | create with PL chars → read back identical; slug transliterated | — |
| AC-17 | Team invite flow: POST /users creates invited user w/ setup token; role change rules (admin cannot create/modify owner) | API integration | invite → PATCH role owner as admin → 403; owner untouched | AC-7 tenant A |
| AC-18 | User deactivation kills sessions immediately (DELETE /users/:id) | API integration | agent session active → admin deletes → agent /auth/me → 401 | AC-7 tenant A |
| AC-19 | BFF proxy: browser reaches API only through web `/api/*`; direct api port not exposed on host (SPEC) | Config check | `docker compose ps` port list; proxy route forwards methods + cookies | — |
| AC-20 | Unit test suite green (`npm test`) | Unit suite | run in api/ | Node ≥22.18 |

Out of scope this release (spec non-goals): SSO/SAML, audit logs, analytics, SLAs, billing metering, SMTP/IMAP worker e2e (worker module not in composed MVP stack — noted in Untested), OpenRouter live AI calls (no API key in test env).

## Verdicts

See `VERIFICATION-REPORT.md` (filled after execution).

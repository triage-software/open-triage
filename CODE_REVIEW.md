# Code review rules

Reviewer rules for this repository, applied by human reviewers and by the `ot-code-review` / `ot-auto-review-pr` skills. Derived from the stack (Next.js 16 web app at the root, NestJS + Prisma API under `api/`) and the conventions observed in the code. Config: `.ai/agentic.config.json`; protected surfaces: `BACKWARD_COMPATIBILITY.md`; process: `SDLC.md`.

## Review priorities, in order

1. **Tenant isolation.** Every API query must run through the tenant-scoped Prisma middleware (`TenantPrismaService`, ADR-0001). A new model, a raw query, or a code path that reads another tenant's data is a **blocker**. There are no public unscoped repositories; guards (`TenantRoleGuard`, `PlatformAdminGuard`) must be present on every controller route except `/auth/*`.
2. **Secrets and credentials.** Mailbox credentials (`passwordEnc`), the OpenRouter key (`data/prototype/settings/openrouter.json`, mode 0600), and `SESSION_SECRET` must never appear in API responses, `state.json`, logs, client bundles, or PR comments. A diff that logs or returns a credential is a **blocker**.
3. **Mail side effects.** SMTP sends and IMAP operations are the one part of the product that reaches real people. Sends must stay idempotent per `deliveryKey` / operation id, preserve the uncertain-send state machine (no automatic second send after a lost SMTP confirmation), keep the Sent-folder copy deduplicated by `Message-ID`, and never let AI send mail autonomously. Reviewers check the reservation/conflict logic, not just the happy path.
4. **Contracts.** Changes to the `/v1` envelope and error codes, the web BFF route shapes (`src/app/api/**`), the `state.json` format, or i18n message keys are checked against `BACKWARD_COMPATIBILITY.md`. A breaking change without the required migration/deprecation path is a **blocker**.
5. **Correctness, then tests.** Bug fixes ship with a regression test that fails without the fix; new features ship with tests for the main unhappy paths (conflicts, retries, missing config, Redis unavailable).
6. **Spec traceability.** Feature PRs implement a covering spec per `.ai/specs/README.md`: the body names it (`Spec:` / `Source doc:` with the `SPEC-NNNN` id) and carries the acceptance-criteria checklist with evidence per box — a ticked box without evidence does not count, and a box deferred without a follow-up issue is a **major** finding. A feature PR with no covering spec and no recorded maintainer waiver is **major**; a spec changed in the diff with `node scripts/check-specs.mjs` red (unregistered or reused id, missing acceptance-criteria block) is **major**.

## Stack-specific checks

### Web app (root: `src/**`, `tests/**`)

- Server-only modules (`src/lib/**`) declare `import "server-only"`; anything touching the filesystem, IMAP/SMTP, or the OpenRouter key stays server-side. A client component importing server-only code fails the build — verify the boundary.
- State mutations go through the serialized queue and `atomicWrite` in `src/lib/store.ts`. Direct `fs/promises` writes to `data/prototype/` outside the store/migration chain are a finding.
- `state.json` shape changes require an in-place migration with a backup (pattern: `migrateMailboxes` / `migrateTeam`, backups under `data/prototype/backups/`), and the loader must stay tolerant of older files.
- Untrusted input (mail bodies, form data, AI output) is parsed with Zod at the boundary; email HTML is converted to text and never rendered as live HTML (no script execution, no tracking-image fetches).
- User-visible strings come from `messages/en.json` and `messages/pl.json` via next-intl — hardcoded UI text is a finding. `node scripts/check-i18n.mjs` must pass.
- Styling is Tailwind CSS 4 with design tokens in `src/app/tokens.css`; new components follow `src/components/ui.tsx` primitives rather than one-off styles.
- Next.js APIs must match the bundled docs in `node_modules/next/dist/docs/` (see `AGENTS.md`) — this Next version has breaking changes vs. older conventions.

### API service (`api/**`)

- Zod DTOs are parsed in controllers/services; validation failures surface as HTTP 400 `{ code: 'VALIDATION_ERROR', ... }` via the global `ZodExceptionFilter` — ad-hoc `throw new Error` for client errors bypasses the contract and is a finding.
- Responses keep the `{ data }` envelope; mutations return `{ data: { ok: true } }` or the record. Error codes (`MAIL_QUEUE_UNAVAILABLE`, `INVALID_CREDENTIALS`, `HOST_UNREACHABLE`, `MAILBOX_IN_USE`, …) are part of the contract.
- Send endpoints require Redis and answer `503 MAIL_QUEUE_UNAVAILABLE` without it; the producer degrades gracefully. A change that makes the API crash or hang without Redis is a blocker.
- Worker jobs are idempotent (delivery keys, `Message-ID` dedup, persisted cursors) and resume after restart; AI retries use the 30 s–5 min backoff and never touch drafts or outgoing mail.
- Migrations are created with `api/scripts/create-migration.mjs`, are additive, and never edit applied migrations. `SESSION_SECRET`-derived encryption must remain decryptable across the change.
- Generated Prisma client types: after schema changes, run `npm --prefix api run generate` before typecheck.

### Tests (both apps)

- Node.js built-in test runner (`node:test`) is the framework on both sides — don't introduce a different runner.
- Mail and AI tests must be hermetic: substituted transports, fake IMAP, temp data directories. A test that opens a real network connection is a blocker.
- Tests share no mutable global state; the web suite runs against a scratch `data/` directory, not a developer's real one.

## Validation gate

Run and report the full gate (any non-zero exit fails review):

```sh
npm run typecheck
npm test
npm run build
npm --prefix api run typecheck
npm --prefix api test
npm --prefix api run build
```

## Severity guidance

- **Blocker** — tenant leak, credential exposure, mail duplication/loss, breaking a protected surface without the required path, data loss in `state.json` handling, red validation gate. Verdict: `changes-requested`; consider `risk-high` + `needs-qa`.
- **Major** — broken error handling on a real path, missing regression test for a fixed bug, contract drift between web and api, i18n keys missing in one locale, unhandled queue/Redis degradation.
- **Minor** — style drift from observed conventions, naming, small duplication, doc gaps. Note in review; do not hold the merge for them.

Label the PR per `SDLC.md` (one pipeline label, category, QA meta, priority, risk) and explain label changes in the `🏷️ label rationale` comment.

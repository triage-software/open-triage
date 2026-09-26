# Contributing to Open Triage

Thanks for helping build an open-source customer-support platform — a shared team inbox with real IMAP/SMTP mail and AI triage. This guide covers the ground rules, the issue-and-spec-first flow, and what reviewers expect from a pull request. The long-form contracts live in [`SDLC.md`](SDLC.md) and [`.ai/specs/README.md`](.ai/specs/README.md); this document is the map.

## Ground rules

These protect what makes the codebase safe to change. A PR that breaks them is a review blocker regardless of size:

- **Spec-driven development.** Every feature starts from a spec with a stable id and testable acceptance criteria — **an issue and a SPEC exist before code does** (details below).
- **Protected surfaces** ([`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md)): the Prisma schema is additive-only (migrations created with `api/scripts/create-migration.mjs`, applied migrations never edited), the `/v1` response envelope is `{ data }` / `{ code, message, details? }`, and `data/prototype/state.json` never changes shape without an in-place migration.
- **Architecture decisions** ([`docs/architecture/ADR-*.md`](docs/architecture)): changing auth, multi-tenancy, the knowledge index, or i18n requires updating the corresponding ADR in the same PR.
- **i18n:** every user-facing string exists in both `messages/en.json` and `messages/pl.json`; `node scripts/check-i18n.mjs` stays green.
- **Secrets** (IMAP/SMTP passwords, OpenRouter keys) never enter `state.json`, API responses, or browser storage; stored mailbox credentials are encrypted and never returned by any endpoint.
- **Mail and AI are side-effect-safe:** tests use substituted transports and never send real mail; AI never auto-sends mail, and customer emails are untrusted user content while approved knowledge is binding system context.

## Branch model

- `main` — release-ready code; every PR targets it.
- Topic branches — one branch per change: `spec/{slug}` for spec PRs, `feat/{slug}`, `fix/{slug}`, `chore/{slug}`, `docs/{slug}` for everything else.

## Issue and SPEC first

Code is the last step, not the first. The flow (full rules: [`.ai/specs/README.md`](.ai/specs/README.md), [`SDLC.md`](SDLC.md)):

1. **Search first** — open issues and the spec registry at the bottom of [`.ai/specs/README.md`](.ai/specs/README.md).
2. **File an issue** using the templates:
   - Bug: `Fix: {symptom}` — reproducibility is the gate; a spec is optional.
   - Feature: `Implement: SPEC-NNNN — {title}` — filled in once the spec exists; a feature issue without a covering spec (or a spec PR in flight) is not filed.
3. **Write the spec** (features and significant changes):
   - Allocate `SPEC-NNNN` = max existing id + 1 across the whole repo, zero-padded to four digits; ids are permanent and never reused or renumbered.
   - Create `.ai/specs/{YYYY-MM-DD}-{kebab-case-slug}.md` with the header id line: `Id: SPEC-NNNN · Status: draft · Date: YYYY-MM-DD · Owner: …`.
   - Include the mandatory `## Acceptance criteria` block: `AC-NN` rows, one observable behavior each, with a verify method (`test` / `e2e` / `manual`).
   - Append the registry row to `.ai/specs/README.md` in the same PR — an id exists when its row exists.
   - `node scripts/check-specs.mjs` must pass.
4. **Get the spec accepted** — the spec lands on its own design-only PR; once merged, the registry status becomes `accepted`.
5. **Implement** — claim the issue, deliver the acceptance criteria phase by phase, and the implementing merge flips the registry status to `implemented`.

## Pull requests

- Target `main`; keep one logical change per PR.
- The PR body carries: what changes for the user, `Spec: SPEC-NNNN (path)`, the acceptance-criteria checklist with evidence per box, and the validation-gate output.
- Every AC box is checked — or explicitly deferred to a follow-up issue — before the PR may sit in `merge-queue`.
- UI changes: attach screenshots or recordings; new strings ship in both locales.

### Validation gate

Run before opening a PR, in this order (authoritative list: `.ai/agentic.config.json`):

```sh
npm run typecheck
npm test
npm run build
npm --prefix api run typecheck
npm --prefix api test
npm --prefix api run build
```

## Review and QA

- A ready, non-draft PR carries the `review` label; the label state machine in [`SDLC.md`](SDLC.md) moves it `review` → (`changes-requested` → `review`)* → `merge-queue`.
- Reviewers read against the checklist in [`CODE_REVIEW.md`](CODE_REVIEW.md); a user-facing change also gets a browser QA pass (`needs-qa`), signed off by a person with `qa-approved` or routed back with `qa-failed`.
- A feature PR that implements no covering spec and carries no recorded maintainer waiver is a review finding.

## Helpful resources

- 🧭 Agent & architecture guide: [`AGENTS.md`](AGENTS.md)
- 📐 Ticket flow, labels, QA gate: [`SDLC.md`](SDLC.md)
- 📝 Spec conventions & registry: [`.ai/specs/README.md`](.ai/specs/README.md)
- 🏛️ Architecture decisions: [`docs/architecture/`](docs/architecture)
- 🔒 Protected contract surfaces: [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md)

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

Thanks for helping make shared inboxes better for everyone!

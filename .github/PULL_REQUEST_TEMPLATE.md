<!-- Pull requests target `main`. Keep one logical change per PR. -->

## Summary

What changes for the user, and why.

## Specification

We follow spec-driven development — an issue and a SPEC exist before code does (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

**Does a spec cover this change?**

- [ ] Yes — `Spec: SPEC-NNNN (path)`
- [ ] No — N/A (bug fix, chore, or docs-only change)

**Spec path:**
<!-- e.g. .ai/specs/2026-09-26-my-feature.md -->

## Acceptance criteria

Copy the `AC-NN` rows the spec assigns to this work. Tick each box with evidence — a test file, an e2e run, or the manual step — or defer it explicitly to a follow-up issue. Every box is checked, or explicitly deferred, before the PR may sit in `merge-queue`.

- [ ] AC-__ —
- [ ] AC-__ —

## Testing & validation gate

```sh
npm run typecheck
npm test
npm run build
npm --prefix api run typecheck
npm --prefix api test
npm --prefix api run build
```

- [ ] Validation gate green (note any command not run, and why)
- [ ] New behavior ships with regression tests; mail/AI tests use fakes and never send real mail
- [ ] User-facing strings added in both `messages/en.json` and `messages/pl.json` (`node scripts/check-i18n.mjs` green)
- [ ] ADR updated when touching auth, multi-tenancy, knowledge indexing, or the i18n approach

## Screenshots (UI changes)

## Decisions touched

<!-- Which product-brief entries (R/N/D), ADRs, or protected surfaces does this PR touch? "None" is a valid answer. -->

## Linked issues

`Fixes #…` / `Implements #…`

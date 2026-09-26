# Contribution guidelines & community files

Id: SPEC-0003 · Status: in-review · Date: 2026-09-26 · Owner: Kamil Mastalerz
Tracked by: #12

## TLDR

The repository has no license, no contributing guide, and no issue/PR templates, so an outside contributor (or a new agent) has nothing that tells them the repo's one non-negotiable rule — **an issue and a SPEC exist before code does** — or the validation gate their PR must pass. This spec ships the community surface: an MIT `LICENSE`, a root `CONTRIBUTING.md` that encodes the spec-driven flow (`SDLC.md` + `.ai/specs/README.md` are the depth, the guide is the map), GitHub issue and PR templates that make the spec reference impossible to skip, and a README tab bar linking **Contributing** and **MIT License**. Everything is adapted from the Open Mercato repo's files and rewritten for this repo's conventions (PRs target `main`, no CLA, SDD with a spec registry).

## Problem statement

- **Who has it:** prospective contributors and new agents landing on `triage-software/open-triage`.
- **What hurts:** GitHub reports no license (legal uncertainty blocks reuse), the Community standards profile is empty, and nothing visible on the landing page points at the SDD flow — the rules exist (`SDLC.md`, `.ai/specs/README.md`) but a newcomer has to already know them to find them.
- **Evidence:** repo root carries no `LICENSE`, no `CONTRIBUTING.md`, no `.github/` directory at all (checked 2026-09-26).

## Proposed solution

1. **`LICENSE`** — MIT text, `Copyright (c) 2026 Open Triage contributors`. GitHub then shows "MIT license" in the About sidebar and Community standards.
2. **`CONTRIBUTING.md`** (root) — the contribution rules that scale:
   - ground rules (protected surfaces: ADRs, `BACKWARD_COMPATIBILITY.md`, i18n both locales, secrets, no real mail in tests, AI never auto-sends);
   - branch model (`main` + topic branches `spec/`, `feat/`, `fix/`, `chore/`, `docs/`);
   - the **issue-and-SPEC-first flow**: file an issue → allocate `SPEC-NNNN` (registry max + 1, never reused) → dated spec file with header id line and mandatory `## Acceptance criteria` → registry row in the same PR → `node scripts/check-specs.mjs` green → spec accepted → then implement;
   - the six-command validation gate (quoted from `.ai/agentic.config.json`);
   - review/QA expectations and pointers to `SDLC.md`, `CODE_REVIEW.md`, the ADRs.
3. **GitHub templates** (`.github/`) — bug report (label `bug`), feature request (label `feature`, spec-first checkboxes), blank issues disabled, and a PR template that requires the spec reference, the `AC-NN` checklist with evidence, and the validation gate results.
4. **README tabs** — a tab bar under the H1 linking **Contributing** → `CONTRIBUTING.md` and **MIT License** → `LICENSE`.

Non-goals: no Contributor License Agreement (MIT needs none), no `CODE_OF_CONDUCT.md` or `SECURITY.md` (worthwhile follow-ups, not this spec), no governance/maintainer model, no changes to any code or to `SDLC.md`/`.ai/specs/README.md` themselves.

## Acceptance criteria

| Id | Criterion | Verify | Covers | Tracked by |
|---|---|---|---|---|
| AC-01 | Given a fresh clone of the repository, the root contains `LICENSE` with the MIT permission text and a "Open Triage contributors" copyright line, so GitHub detects and displays the MIT license. | manual | — | #12 |
| AC-02 | Given the root `CONTRIBUTING.md`, it documents the issue-and-spec-first flow (issue templates, `SPEC-NNNN` allocation from the registry, dated spec file with header id line, mandatory acceptance criteria, registry row in the same PR, `node scripts/check-specs.mjs`), the branch model with PRs targeting `main`, the six-command validation gate, and the review/QA expectations. | manual | — | #12 |
| AC-03 | Given the README landing page, the first content under the H1 is a tab bar whose links open `CONTRIBUTING.md` (label "Contributing") and `LICENSE` (label "MIT License"). | manual | — | #12 |
| AC-04 | Given `.github/`, submitting a new GitHub issue offers only the bug template (label `bug`) and the feature template (label `feature`, which requires answering whether a spec exists), and a new PR is prefilled with a body requiring the spec path, an acceptance-criteria checklist with evidence, and the validation-gate commands that were run. | manual | — | #12 |
| AC-05 | Given this spec's changes, `node scripts/check-specs.mjs` exits 0 with SPEC-0003 present in the registry with a matching header status. | manual | — | #12 |

## 📋 Implementation plan

- **Step 1 — spec & tracking issue** (`AC-05`): this spec, the registry row, the `Implement:` issue filed before implementation lands.
- **Step 2 — license & README tabs** (`AC-01`, `AC-03`): root `LICENSE`; tab bar under the README H1.
- **Step 3 — contributing guide** (`AC-02`): root `CONTRIBUTING.md` adapted from Open Mercato's, rewritten for `main`-based SDD flow without the CLA.
- **Step 4 — GitHub templates** (`AC-04`): `.github/ISSUE_TEMPLATE/{bug_report.md,feature_request.md,config.yml}`, `.github/PULL_REQUEST_TEMPLATE.md`.
- **Step 5 — gate & PR** (`AC-01`–`AC-04` evidence): validation gate run on the PR body; docs-only diff, so the gate is expected green with no code touched.

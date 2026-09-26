# Specs & issues — SDD conventions

This repository runs **Spec-Driven Development (SDD)**: every feature starts as a spec with a stable id and testable acceptance criteria, and every artifact that implements it — issue, PR, commit — references that id back. This file is the canonical ruleset for spec identifiers, naming, statuses, acceptance criteria, and the reference conventions that connect specs to issues and PRs. Agents apply it automatically (it is wired into `AGENTS.md` and the repo-local skill overrides under `.ai/skills/`); humans read it here.

Precedence: `AGENTS.md` and the ADRs > this file > installed skill defaults. Nothing in here overrides a protected surface in `BACKWARD_COMPATIBILITY.md` or an active decision in `product-brief.md`.

Mechanical check: `node scripts/check-specs.mjs` — ids unique and registered, header lines present, acceptance-criteria blocks present, references resolvable. Run it whenever a spec changed; it is advisory today (review tooling), not part of the validation gate.

## Artifact map

| Artifact | Id form | Lives in | Numbered by |
|---|---|---|---|
| Product brief | — (single file) | `.ai/specs/product-brief.md` | not applicable |
| Discovery decision records | `D01`, `D02`, … (brief-owned) | `.ai/specs/research/decisions/` | the brief's Decisions/Non-goals/Rules tables |
| Brief entries (rules, non-goals, decisions, questions, assumptions) | `R01`, `N01`, `D07`, `Q03`, `A01` | `product-brief.md` tables | the brief; changed only by a superseding row (see `SDLC.md`) |
| Architecture decisions | `ADR-0001`, … | `docs/architecture/ADR-*.md` | own sequence, next = max + 1 |
| **Specs (all kinds)** | **`SPEC-0001`, …** | `docs/architecture/` and `.ai/specs/` | **one shared repo-wide sequence, this file's registry** |
| Issues | `#123` (GitHub's number) | tracker | GitHub — never mint parallel issue numbers |

A spec id and an issue number are different identifiers: `SPEC-0007` names the design, `#42` names the tracking ticket. Never use one in place of the other.

## Allocating a spec id

1. Read the **Spec registry** at the bottom of this file.
2. Sweep for ids the registry might be missing: `grep -rhoE 'SPEC-[0-9]{4}' docs .ai src api tests --include='*.md' | sort -u`. If an id appears somewhere but has no registry row, add the row (never renumber to make the sweep clean).
3. The next id is **max(existing ids) + 1, zero-padded to four digits** — across the whole repo, architecture and feature specs alike.
4. Append the registry row **in the same commit/PR as the spec**. An id exists when its row exists.

Rules:

- Ids are permanent. A rejected, superseded, or abandoned spec keeps its id forever; nothing is reused, renumbered, or compacted.
- Allocation happens at spec-creation time (the skeleton step), before the file is named or referenced anywhere.
- Concurrent allocations collide rarely; if two spec PRs carry the same id, the one merged first keeps it and the other rebases onto the next free number. The registry is merge-order truth.
- A material redesign of an accepted spec is a **new spec**: allocate a fresh id and mark the old one `superseded` with a `Supersedes:` line in the new header. Editorial fixes edit in place with no new id.

## Spec files

- **Feature/design specs** live in `.ai/specs/` with the dated filename shape `{YYYY-MM-DD}-{kebab-case-slug}.md`. That shape is load-bearing — `ot-followup-issue-from-pr` recognizes it when filing `Implement:` tracking issues — so the id does **not** go in the filename; it goes in the header line (below).
- **Architecture specs** live in `docs/architecture/` as `SPEC-NNNN-{slug}.md` (existing convention: `SPEC-0001-mvp-architecture.md`).
- Slug: kebab-case, verb-led where natural, at most five words, stable for the life of the spec (branches `spec/{slug}` and asset dirs `assets/{slug}/` derive from it).

Every spec opens with the H1 title followed by a metadata block:

```markdown
# {Title}

Id: SPEC-0007 · Status: draft · Date: 2026-09-26 · Owner: Kamil Mastalerz
Depends on: ADR-0002 (auth)
Supersedes: SPEC-0004
```

`Id`, `Status`, `Date`, and `Owner` are required; `Depends on:` / `Supersedes:` lines are added when applicable. The **registry row's Status is the source of truth**; the header mirrors it.

### Status lifecycle

`draft → in-review → accepted → in-progress → implemented`, with exits to `superseded` or `rejected` from any point.

- `draft` — being written; not yet on a PR.
- `in-review` — the spec PR is open (PR label `review` per `SDLC.md`).
- `accepted` — the spec PR merged. A spec PR with `⚠ NEEDS HUMAN CONFIRMATION` assumptions merges only after those are confirmed, then becomes `accepted`.
- `in-progress` — an implementation PR is open against the spec.
- `implemented` — the implementation PR merged.
- `superseded` — replaced by a newer spec (header of the old one points at the new id).
- `rejected` — declined before implementation; the row stays as the record of the decision.

### Mandatory sections

Content sections follow the `ot-spec-writing` template (TLDR, Problem Statement, Proposed Solution, Architecture, Data Model, API Contracts, UI/UX, Edge Cases, Risks, Decisions in play, Phasing, Implementation Plan — omit empty ones). SDD adds two obligations on top:

1. **`## Acceptance criteria`** (mandatory, below) — placed before `## 📋 Phasing`.
2. **Step ↔ AC mapping** — every `## 📋 Implementation Plan` step names the acceptance criteria it delivers (`Step 3 — sent-copy dedup (AC-04, AC-05)`). An AC with no step, or a step with no AC, is a review finding.

## Acceptance criteria

Every spec carries an `## Acceptance criteria` block as a table:

```markdown
## Acceptance criteria

| Id | Criterion | Verify | Covers | Tracked by |
|---|---|---|---|---|
| AC-01 | Given a signed-in staff member with an assigned conversation, when they click "Generate suggestion", then exactly one draft appears in the composer and no message is sent automatically. | test | R02 | #42 |
| AC-02 | Given SMTP answers with a timeout after the send, when the worker retries, then no second message is transmitted and the conversation stays blocked until the Sent copy is confirmed. | e2e | R05 | #43 |
```

Column rules:

- **Id** — `AC-01`, `AC-02`, … two digits, starting at `AC-01`. Ids are stable once the spec is accepted; a changed criterion keeps its id and explains itself in the spec's history, a new criterion gets the next number.
- **Criterion** — exactly one observable behavior, phrased so pass/fail is decidable without reading the implementation. Given/When/Then or "given X, the system shows Y" form. Never bundle two behaviors with "and" — split into two ACs. The happy path **and** the main unhappy paths (conflict, failure, empty, permission-denied) each get their own ACs. An AC that encodes a business rule cites its `R##` id in *Covers*.
- **Verify** — one of `test` (unit/regression test in `tests/` or `api/test/` — name the file when it exists), `e2e` (browser walk: `ot-auto-qa-pr` / `ot-integration-tests` coverage), `manual` (a written manual step in the spec or PR). Every AC must be verifiable by at least one of the three; "obviously correct" is not a verify method.
- **Covers** — the brief entry the AC implements or is bounded by (`R02`, `D07`, `N01`), or `—`.
- **Tracked by** — the issue(s) delivering the AC, filled when the issue is filed; `—` until then.

Writing rules:

- The block is written **with the spec**, not after it — including in `--autonomous` runs, where it is composed from the resolved defaults like every other section. It is never an Open Question.
- A spec whose every AC reads `manual` is a smell: prefer `test` for logic and `e2e` for user-facing flows; `manual` is for what genuinely cannot be automated today.
- If an AC turns out untestable as written, fix the AC (it is usually two ACs or an unobservable criterion), not the test suite.

### AC traceability chain

```
product-brief.md          spec                  issue                 PR
R02 / D07 / N01  ──►  SPEC-0007 AC-02  ──►  Implement: SPEC-0007  ──►  AC checklist + evidence
                      (Covers: R02)        (Implements: AC-02)
```

- The **issue body** carries, near the top: `Spec: SPEC-0007 (.ai/specs/2026-09-26-{slug}.md)` and `Implements: AC-02, AC-03` — exactly the AC ids the issue delivers. Several issues may split one spec's ACs (a phase each), but one AC is delivered by exactly one issue.
- The **implementing PR body** carries `Source doc:` / `Spec:` plus an AC checklist with evidence per box:

  ```markdown
  ## Acceptance criteria
  - [x] AC-02 — `tests/mail-send.test.mjs` (uncertain-send stays blocked)
  - [ ] AC-03 — deferred to #57 (i18n strings for the banner)
  ```

  Every box is checked, or explicitly deferred to a follow-up issue, before the PR may sit in `merge-queue`. A ticked box without evidence does not count.
- The implementing PR merging flips the registry status to `implemented` (and post-merge housekeeping closes the issues).

## Issue conventions

- Issue titles (no emoji):
  - Spec-backed feature: `Implement: SPEC-0007 — Sent-copy dedup hardening` — the `Implement: ` prefix stays first so the installed skills' dedup and tracking-issue conventions keep matching; the spec id travels inside the title.
  - Spec-less small feature: `Implement: {action-oriented title}`.
  - Bug: `Fix: {symptom}`.
  - Multi-phase specs: one issue per phase, each titled `Implement: SPEC-0007 (phase 1) — {…}` and listing its own AC subset.
- The body meets the ticket-level Definition of Ready (`SDLC.md`) and cites brief ids (`D03`, `N01`, `R05`) wherever a brief entry bounds the work.
- Bugs: reproducibility is the gate (`ot-verify-in-repo`); a spec is optional. When a bug fix reveals a design gap, record it: either amend the spec in the same PR (editorial change, registry note) or file the superseding spec.

## SDD flow (who creates what, when)

1. **Shape** — `ot-discover` / `ot-brainstorm` maintain the brief; its `R/N/D/Q/A` ids are the vocabulary every spec cites.
2. **Spec first** — a feature becomes a spec before it becomes an issue or code: `ot-spec-writing` (interactive) or `ot-auto-write-spec` (autonomous, lands the spec on a design-only PR). The id is allocated at the skeleton step; the registry row ships with the spec PR.
3. **Issue** — `ot-prepare-issue` files the tracking issue against the covering spec, with the `Implements:` AC list. A feature issue without a covering spec and without a spec-PR in flight is not filed (this is the installed skill's rule; the Definition of Ready is the contract).
4. **Implement** — `ot-auto-implement-spec` / `ot-auto-fix-issue` (or a human author) deliver phase by phase; the PR carries the AC checklist and passes the validation gate.
5. **Close the loop** — merge flips the registry status; `ot-close-fixed-issues` reconciles the tracker; follow-ups get their own issues (and, when they are features, their own specs).

A feature PR that implements no covering spec and carries no recorded waiver (maintainer's comment on the ticket) is a review finding per `CODE_REVIEW.md`.

## Spec registry

The table below is the single source of truth for spec ids and statuses. Append a row when you allocate an id; keep Status current.

| Id | Title | File | Status | Date | Owner |
|---|---|---|---|---|---|
| SPEC-0001 | open-triage MVP architecture | docs/architecture/SPEC-0001-mvp-architecture.md | accepted | 2026-09-12 | solution-architect |

Unnumbered context artifacts (not specs, no rows): `product-brief.md`, `research/decisions/D01–D09.md`, `research/templates/`.

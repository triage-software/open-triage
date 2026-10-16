# Execution plan — CI validation gate

- Date: 2026-09-21 · Slug: ci-validation-gate · Branch: feat/ci-validation-gate · Base: main
- Source brief: issue #5 (https://github.com/triage-software/open-triage/issues/5)
- Source doc: .ai/specs/product-brief.md (Scope "Now", decision D07)

## Goal

Every pull request automatically runs the repository's six-command validation gate (both applications: web at root, api under `api/`), so gating no longer depends on discipline.

## Scope

- Add `.github/workflows/ci.yml` — triggers on `pull_request` and pushes to `main`; one job on ubuntu-latest / Node 22.
- The command list mirrors `validation.commands` from `.ai/agentic.config.json`; SDLC.md's drift rule requires the workflow, the config, and SDLC.md to change together.

## Non-goals

- No deployment or release automation; no new tooling or runners.
- No branch-protection / required-check changes (maintainer follow-up).
- No repository secrets — the gate needs none (local `npm run build` passes without env).
- No product code changes; no protected surface from BACKWARD_COMPATIBILITY.md.

## Implementation plan

### Phase 1: Workflow file

1. Add `.github/workflows/ci.yml`: checkout, setup-node 22 with npm cache (both lockfiles), `npm ci` at root and in `api/`, explicit `prisma generate` for the api, then the six gate commands in config order.
2. Add a concurrency group so superseded runs cancel.

### Phase 2: Verification

1. Run the full validation gate locally in the worktree; fix anything red.
2. Watch the workflow run on this PR and confirm it passes.
3. Re-check the workflow's command list against `.ai/agentic.config.json` line by line.

## Risks

- The workflow's first run is its own verification; if Actions minutes are a concern, the job is one Node job (~ minutes).
- `@prisma/client` postinstall generation can be skipped by npm script policies — the explicit `prisma generate` step covers it.

## Progress

PR: #6 (link: https://github.com/triage-software/open-triage/pull/6)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Workflow file

- [x] 1.1 Add .github/workflows/ci.yml: pull_request + push-to-main triggers, concurrency cancel, Node 22, npm ci for root and api, prisma generate — 19e4a5a
- [x] 1.2 Workflow runs the six validation commands in .ai/agentic.config.json order — 19e4a5a

### Phase 2: Verification

- [x] 2.1 Full local validation gate green in the worktree — recorded at finalize
- [x] 2.2 Workflow triggers on this PR and the run passes — https://github.com/triage-software/open-triage/actions/runs/35592400061
- [x] 2.3 Command list in the workflow matches .ai/agentic.config.json exactly

Engine: ot-auto-create-pr (steps: 5, --loop: no)

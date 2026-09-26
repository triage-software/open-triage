---
name: ot-prepare-issue
description: Repo-local extension of the installed ot-prepare-issue skill — issue titles and bodies carry the covering spec id and the acceptance-criteria ids it delivers (SDD). Always apply together with the installed skill; where the two differ, the stricter rule wins.
---

# ot-prepare-issue — repo extension (Spec-Driven Development)

The canonical conventions live in `.ai/specs/README.md` — read that file first. Run the installed `ot-prepare-issue` skill exactly as documented, with the amendments below. Nothing here relaxes the installed skill's rules.

**Step 5 title, when a covering spec exists:** carry the spec id inside the title — `Implement: SPEC-NNNN — <feature title>`. The `Implement: ` prefix stays first so the installed dedup and tracking-issue conventions keep matching. Bugs stay `Fix: <symptom>`; spec-less small features stay `Implement: <title>`; a phase-scoped issue is `Implement: SPEC-NNNN (phase 2) — <title>`.

**Step 5 body, when a covering spec exists:** add two reference lines near the top:

- `Spec: SPEC-NNNN (<path>)`
- `Implements: AC-01, AC-02 …` — exactly the acceptance-criteria ids from the spec's `## Acceptance criteria` block that this issue delivers. Never cite an AC the issue does not deliver; one AC is delivered by exactly one issue (several issues may split a spec's ACs, one issue per phase is the normal cut).

**Step 2 (covering-spec search):** match specs by their `SPEC-NNNN` id and TLDR — check `.ai/specs/README.md`'s Spec registry first, then the files. When the brief's ask is not covered by any registry row, the spec-authoring path (step 3) allocates the next id per `.ai/specs/README.md` before the issue is filed.

**Issue numbers** are GitHub's `#NN` — never mint parallel issue numbers. `SPEC-NNNN` names the design; `#NN` names the ticket; the PR connects them (`Source doc:` / `Spec:` line, `Closes #NN` on the implementing PR only, `Refs` on spec PRs).

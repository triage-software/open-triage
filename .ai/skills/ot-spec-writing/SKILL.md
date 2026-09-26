---
name: ot-spec-writing
description: Repo-local extension of the installed ot-spec-writing skill — adds SDD numbering (SPEC ids allocated from the registry), the mandatory Acceptance criteria block, and registry bookkeeping. Always apply together with the installed skill; where the two differ, the stricter rule wins.
---

# ot-spec-writing — repo extension (Spec-Driven Development)

This repository runs SDD; the canonical conventions live in `.ai/specs/README.md` — read that file first, it overrides generic defaults wherever they conflict. Run the installed `ot-spec-writing` skill exactly as documented, with the amendments below. Nothing here relaxes the installed skill's safety or quality rules.

## Amendments to the installed workflow

**Step 2 (Initialize) — allocate the spec id before creating the file.**

1. Read `.ai/specs/README.md` and its **Spec registry** table.
2. Take the next free id: `max(existing SPEC-NNNN ids) + 1`, zero-padded to four digits. Sweep `docs/` and `.ai/` for ids the registry may be missing (`grep -rhoE 'SPEC-[0-9]{4}' docs .ai --include='*.md' | sort -u`) and add missing rows rather than renumbering.
3. Create the file with the installed naming — `${SPECS_DIR}/{YYYY-MM-DD}-{slug}.md`, unchanged, the shape is load-bearing for `ot-followup-issue-from-pr` — and put the id in a metadata line directly under the H1:
   `Id: SPEC-NNNN · Status: draft · Date: {today} · Owner: {name}` — plus `Depends on:` / `Supersedes:` lines when applicable.
4. Append the matching row to the registry table in the same commit as the spec. An id exists when its row exists; ids are never reused, renumbered, or compacted.

**Template — the Acceptance criteria block is not optional.** In addition to the installed sections, every spec carries `## Acceptance criteria` (table: Id / Criterion / Verify / Covers / Tracked by) placed before `## 📋 Phasing`, following the column and writing rules in `.ai/specs/README.md`. Every `## 📋 Implementation Plan` step names the ACs it delivers (`Step 3 — sent-copy dedup (AC-04, AC-05)`); an AC with no step or a step with no AC is a review finding.

In `--autonomous` mode the block is written from the resolved defaults like every other section — it is never an Open Question and never deferred.

**Header status.** Keep the header `Status:` current (`draft → in-review → accepted` is owned by the spec workflow; `in-progress` / `implemented` are flipped by the implementing PR). The registry row's Status is the source of truth — update both in the same commits.

**Verify before reporting.** Run `node scripts/check-specs.mjs` and include the result in the report; a red check on a fresh spec is a bug in the spec, not in the check.

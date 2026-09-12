# Cross-skill coverage check

Skills in this collection delegate to each other by name (e.g. the autofix
chain `ot-verify-in-repo` → `ot-root-cause` → `ot-fix` → `ot-open-pr` →
`ot-auto-review-pr`) and point at each other's reference files
(`ot-<skill>/references/<file>`). A cherry-picked install can leave those
references dangling. This check finds every dangling reference and produces one
ready-to-paste command that installs everything missing.

Run it during setup (workflow step "Verify cross-skill coverage") and any time
the user reports a skill "not found" mid-pipeline.

## Where installed skills live

`SKILLS_ROOT` is the directory that contains the installed skills — the parent
of this skill's own directory (the directory holding the `SKILL.md` you are
reading). For Claude Code this is typically `~/.claude/skills`; for Codex
`~/.codex/skills`; project-level installs use the agent's project skill
directory. Resolve it from this skill's actual location, not from a guess.

A reference is also satisfied by a repo-local skill at
`.ai/skills/<name>/SKILL.md` — repo-local skills count as available.

## Detection

Two kinds of references must resolve:

1. **Name references** — mentions of a collection skill (`ot-…`) in any of an
   installed skill's markdown files. Only names in the roster below count;
   other `ot-…` tokens (repo docs like a philosophy file, or substrings of
   hyphenated words) are not missing skills.
2. **File references** — explicit cross-skill pointers of the form
   `ot-<skill>/references/<file>`; the target must exist inside the installed
   sibling skill.

Runnable check (POSIX shell; run from the repository root so repo-local
`.ai/skills/` overrides are seen):

```bash
# SKILLS_ROOT: parent directory of this skill's installed directory.
SKILLS_ROOT=${SKILLS_ROOT:-"$HOME/.claude/skills"}
ROSTER="ot-apply-upgrade-notes ot-approve-merge-pr ot-auto-continue-pr ot-auto-continue-pr-loop ot-auto-create-pr ot-auto-create-pr-loop ot-auto-fix-issue ot-auto-fix-pr ot-auto-implement-spec ot-auto-manage-issues ot-auto-qa-pr ot-auto-review-pr ot-auto-update-changelog ot-auto-write-spec ot-brainstorm ot-check-and-commit ot-close-fixed-issues ot-code-review ot-competitor-site-teardown ot-create-skill ot-discover ot-fix ot-followup-issue-from-pr ot-geo-i18n-strategy ot-integration-tests ot-merge-buddy ot-open-pr ot-rebrand-ui ot-pipeline-retro ot-pr-autopilot ot-prepare-issue ot-prepare-test-env ot-review-prs ot-root-cause ot-setup-agent-pipeline ot-spec-writing ot-ux-review-pr ot-ux-setup ot-ux-shape ot-verify-in-repo ot-website-deploy"
missing=""
add_missing() { case " $missing " in *" $1 "*) ;; *) missing="$missing $1" ;; esac; }
for dir in "$SKILLS_ROOT"/ot-*/; do
  [ -f "${dir}SKILL.md" ] || continue
  for ref in $(grep -rhoE '(^|[^A-Za-z-])ot-[a-z][a-z-]*[a-z]' --include='*.md' "$dir" 2>/dev/null \
               | grep -oE 'ot-[a-z][a-z-]*[a-z]' | sort -u); do
    case " $ROSTER " in *" $ref "*) ;; *) continue ;; esac   # roster names only
    [ -d "$SKILLS_ROOT/$ref" ] && continue                   # installed
    [ -f ".ai/skills/$ref/SKILL.md" ] && continue            # repo-local skill
    add_missing "$ref"
  done
done
# Cross-skill file pointers must resolve inside the installed sibling.
for hit in $(grep -rhoE 'ot-[a-z-]+/references/[A-Za-z0-9._/-]+' --include='*.md' \
             "$SKILLS_ROOT"/ot-*/ 2>/dev/null | sort -u); do
  [ -e "$SKILLS_ROOT/$hit" ] || add_missing "${hit%%/*}"
done
[ -z "$missing" ] && echo "SKILL_COVERAGE_OK" || echo "SKILL_COVERAGE_MISSING:$missing"
```

The roster is the complete list of skills this collection ships and is kept in
sync with the collection by the repo's lint gate. The leading-context guard in
the first grep (`(^|[^A-Za-z-])`) drops substrings of hyphenated words such as
`custom-provider`; the roster intersection drops everything that is not a
collection skill.

## Remediation

When the check prints `SKILL_COVERAGE_MISSING`, tell the user exactly what is
missing, which installed skills need it, and give them one command they can
paste and run as-is — one `--skill` flag per missing name:

```bash
npx skills add <collection-source> --skill ot-fix --skill ot-root-cause
```

When many skills are missing, the simplest fix is installing the whole
collection (every skill is small until invoked):

```bash
npx skills add <collection-source> --skill '*'
```

`<collection-source>` is the `<owner>/<repo>` argument the skills were
originally installed with — never guess it. Resolve it in this order:

1. If this skill's installed directory is a symlink into a development
   checkout, follow it and read the checkout's `package.json`
   (`repository.url`) or `git remote get-url origin`.
2. Install metadata the skills CLI keeps near `SKILLS_ROOT` (a lock or
   manifest file naming the source), when present.
3. Ask the operator once, then reuse the answer for every command printed in
   this run.

Substitute the resolved source into the command before showing it — the goal is
paste-and-run, not a template. After the user runs the install, re-run the
check and confirm it prints `SKILL_COVERAGE_OK`; setup is not complete while
references dangle. In unattended runs (`--defaults`) nothing can be installed
interactively: report the missing list and the exact command in the final
summary instead, and continue setup — the config itself is still valid.

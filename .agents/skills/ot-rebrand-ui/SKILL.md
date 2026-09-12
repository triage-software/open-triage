---
name: ot-rebrand-ui
description: Apply a published design system to an existing prototype — vendored tokens as single source, legacy-hex census with OKLCH classification, component/contrast pass, logo + typography swap, verification (typecheck, tests, hex census), and before/after screenshot evidence via a pinned worktree. Use when rebranding a UI or auditing leftover default styling.
---

# Rebrand UI (design system → prototype)

Roll a published design system onto an existing app so nothing default-looking
survives, and leave verifiable evidence. The deliverable is not "looks changed"
— it is a census that proves zero legacy styling, plus before/after screenshots
from the exact commits involved.

## Arguments

- `{app-dir}` (required) — the prototype/app repo to rebrand.
- `{design-system-dir}` (required) — the published DS (tokens.css/variables.css, brand.json, DESIGN.md).

## Method

1. **Pin the evidence base BEFORE touching anything.** Record the current HEAD
   and the DS source commit. The pre-rebrand commit is your "before" screenshot
   base — if you skip this, before/after evidence is gone forever.
2. **Vendor tokens, single owner.** Copy the DS variables file into the app
   (e.g. `src/app/tokens.css`) and define short semantic aliases in one `:root`
   block. App CSS consumes ONLY the aliases; third-party stylesheets must not
   redefine the token namespace (a redefinition silently splits the palette).
   Keep legacy variable NAMES as aliases to the new tokens
   (`--purple: var(--ot-accent)`) — class names and selectors survive, values
   rebrand.
3. **Census → codemod.** Count literal hexes per stylesheet
   (`grep -cE '#[0-9a-fA-F]{6}'`). CENSUS THE WHOLE `src/` TREE, not the
   stylesheets you happen to know — late-added files (e.g. `styles/*.css`
   from a parallel workstream, MJML templates under `src/lib/`) are where
   leftovers hide. Classify every hit by OKLCH hue/lightness
   (cool blue/violet hues = legacy; warm paper/ink hues = keep as alpha
   shadows). Tenant-facing identity colors (the demo tenant's outbound mail
   template) are the tenant's brand, not the app's — list them as intentional
   keeps instead of rebranding them. Map each legacy hex to the nearest DS
   ramp step rather than hand-tweaking per element. Re-run the census after —
   target is 0 cool-hue hits in UI code; surviving warm shadow alphas and
   tenant identity colors get listed in the commit body.
4. **Component pass, not just variables.** Buttons (primary must hit WCAG AA
   with its text color — verify the pair numerically), focus rings, status
   chips and badges mapped to ramp steps, data-viz seed colors moved into the
   brand family, page headings on the DS type scale, favicon/app icon replaced
   by the brand mark.
5. **Verify the code claims yourself.** Typecheck + tests + production build
   green; re-run the hex census; audit every remaining literal. Never trust a
   commit message that says "verified" — run it.
6. **Before/after screenshots via a pinned worktree.**
   - `git worktree add .design-worktree <pre-rebrand-commit>` in the app repo.
   - Dependencies usually did not change in a pure rebrand — check
     `git diff --stat <pre>..HEAD -- package.json '*lock*'`; if empty, share
     install state by APFS-cloning node_modules into the worktree:
     `cp -cR node_modules .design-worktree/node_modules`. Turbopack REJECTS a
     symlinked node_modules ("points out of the filesystem root") — clone, do
     not link.
   - Production-build both trees (`next build`) and serve on free ports;
     production output screenshots clean (no dev overlay). Screenshot every
     route/variant with headless Chrome in a loop:
     `--headless=new --window-size=1600,1000 --virtual-time-budget=10000 --screenshot=…`.
   - Seed demo data through the app's own ingestion path so screens are not
     empty; back up any existing local state file first and restore it after.
     If the app's store module imports `server-only`, a plain node seed run
     dies with "This module cannot be imported from a Client Component" —
     ship a seed loader that stubs it (`registerHooks` resolve hook returning
     `data:text/javascript,export{}` for `server-only`, plus the
     extensionless→`.ts` resolution the test harness uses); the test
     bootstrap alone does not cover script runs.
   - COPY the seeded data file into the worktree's data dir before
     screenshotting; a worktree checkout has none and the gitignored data dir
     does not travel with `git worktree add`.
   - Commit the screenshots IN THE RUN. A crashed run loses uncommitted
     evidence, and the PR body it left behind rots into
     `user-attachments/assets/REPLACE-n` placeholders. Committed-in-repo
     screenshot paths (docs/design/brand-rollout/<date>/…, referenced from the
     PR body) survive crashes and make the diff reviewable.
   - Quantify the delta, don't just eyeball: a per-pixel before/after diff
     (same viewport, same seed data) gives a hard number per view — same
     layout re-tint lands ~2-3%, full-theme swap ~50-65%. Deviations from
     that pattern mean layout drift, not rebrand.
   - Store shots under `docs/design/brand-rollout/<date>/before|after/*.png`,
     list them in the commit body, and LOOK at one flagship shot afterwards —
     a 200 status proves nothing about rendering.
7. **Land it.** Stage explicit paths only (never `git add -A` — siblings may be
   working in the same repo), commit with the census + contrast numbers in the
   body, then tear the worktree down (`git worktree remove --force`).

## Output

- Rebranded app at HEAD; census table (per-file hex counts before → after).
- `docs/design/brand-rollout/<date>/` with before/after screenshots.
- Commit body naming: tokens source, codemod classification, contrast pairs
  (ratio numbers), verification results, screenshot paths.

## Rules

- Single token owner: exactly one file defines the namespace; everything else
  consumes aliases. Duplicate definitions are rebrand rot.
- Never screenshot an unseeded or half-migrated app; evidence must show real
  content in both states.
- Never claim colors changed without either a census delta or an inspected
  screenshot — describe only what you captured.
- Shared rules: `ot-create-skill/references/rules.md` — secrets hygiene (never
  commit session cookies, SMTP credentials, or API keys picked up from env
  files during verification), claim etiquette. They always apply.

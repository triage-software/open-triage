# Brand rollout evidence — 2026-09-12

Before/after screenshots for the open-triage design-system rollout onto the
prototype (task t_988a6db1).

- `before/` — prototype at commit `5c6ef8c` (pre-rebrand, legacy cool purple/envelope theme)
- `after/` — prototype at commit `470d84c` + follow-up token fix (warm "paper & oat" DS)

Both trees served the same seeded demo data (`scripts/seed-demo-mail.mjs`,
6 ingested messages) and were production-built (`next build`), screenshotted at
1600x1000 with headless Chrome.

| shot | pixel diff (before→after) |
|---|---|
| prototype-inbox | 2.57% (chrome re-tint, same layout) |
| prototype-queue | 55.44% |
| prototype-board | 62.61% |
| sign-in | 51.04% |

Verification accompanying these shots: `tsc --noEmit` clean, 39/39 tests pass
(node 24), `next build` clean, hex census `src/` excl. vendored tokens = 0
cool-hue literals (all remaining literals are warm brand tones or the demo
tenant's own outbound-mail identity in `src/lib/mail-template.ts`).

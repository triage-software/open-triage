---
name: ot-website-deploy
description: Deploy the open-triage marketing website (Next 16 + next-intl proxy) to the Hetzner server via Dokploy — project setup, build settings, domain, and the post-deploy geo-matrix verification. Use when deploying or redeploying open-triage-website.
---

# Deploy open-triage-website (Hetzner + Dokploy)

Hosting decision (2026-09-12, orchestrator): Hetzner + Dokploy, overriding
ADR-0001's initial Vercel pick. Addendum lives in
`docs/adr/ADR-0001-website-architecture.md` in triage-software/open-triage-website.

## Pre-flight (all gates green BEFORE touching the server)

Run in a clean clone of `triage-software/open-triage-website` on the commit you
will deploy (Node ≥ 22 — `export PATH=~/.nvm/versions/node/v22.17.0/bin:$PATH`;
PATH node is v16 and `npm run typecheck` fails on it):

1. `npm run typecheck` → tsc clean
2. `npm test` → 17/17
3. `npm run build` → 8 routes SSG + Proxy
4. `PORT=3311 npm run start` + `scripts/verify-runtime.py` (edit BASE or port)
   → geo matrix ALL PASS; then run the QA battery if defects were touched:
   `/tmp/qa-venv/bin/python qa/interactive-qa.py` → 44/44

Never deploy a commit that did not pass locally; CI green on main is the
minimum, not the bar.

## Dokploy project setup (server side)

Server: existing Hetzner box (SSH coordinates are operator-held — agents in
this environment have NO key auth; ask the operator or run via an
operator-authenticated session). Dokploy UI → Projects → New project:

- **Project:** `open-triage-website`
- **Service type:** Application (Docker Compose or Nixpacks/Build). Preferred:
  **Dockerfile-less build** — Dokploy Build type "Nixpacks" handles Next 16;
  if Nixpacks picks a wrong Node, add a `Dockerfile`:
  `FROM node:22-alpine` + `npm ci && npm run build` + `npm start`,
  `ENV PORT=3000`, `EXPOSE 3000`.
- **Git source:** triage-software/open-triage-website (private → register a
  GitHub token in Dokploy Settings → Git; token needs `repo` read).
- **Branch:** `main`. **Trigger:** manual or on-push webhook (GitHub →
  Settings → Webhooks → Dokploy deploy URL) — prefer on-push.
- **Build command:** `npm ci && npm run build`; **Start:** `npm start`
  (binds 127.0.0.1 by default via package.json — Dokploy/Traefik needs
  0.0.0.0; override start with `npx next start -H 0.0.0.0 -p 3000` or edit
  package.json start script before deploying).
- **Port:** container 3000; Dokploy assigns the host mapping.
- **Env:** none required for the website (secrets-free marketing site).
  Optional `NODE_ENV=production`.
- **Resource floor:** 1 vCPU / 1 GB is enough (SSG + proxy runtime).
- **Domain:** Dokploy → Domain tab → generate domain `*.traefik.me` for the
  first deploy (HTTPS automatic via Traefik/Let's Encrypt). Custom domain
  (e.g. opentriage.dev) is a separate operator decision — do NOT block on it;
  when added, set both apex + `www`, keep the generated domain as fallback.

## Post-deploy verification (acceptance)

Run the geo matrix against the LIVE URL — adapt `scripts/verify-runtime.py`
by replacing `BASE = "http://127.0.0.1:3311"` with the live base URL:

1. PL Accept-Language `/` → 307 `/pl`
2. Cookie `NEXT_LOCALE=pl` `/` → 307 `/pl`
3. `/?lang=pl` → 307 `/pl?lang=pl` + `Set-Cookie: NEXT_LOCALE=pl`, second hop
   200, no proxy loop
4. `/en` → 307 `/` (canonicalization), EN stays 200
5. All 6 routes (`/`, `/demo`, `/mockups`, `/pl`, `/pl/demo`, `/pl/mockups`)
   → 200; `/pl` HTML contains PL diacritics (e.g. "Zobacz demo" / "licencja")
6. hreflang trio `en`, `pl-PL`, `x-default` in served HTML
7. Zero console errors on the 6 routes (Playwright pass, mobile viewport spot
   check at 390px — nav must not overflow: `document.documentElement.scrollWidth === 390`)

## Redeploy rules

- Deploy only from `main` after the PR merge; never deploy feature branches.
- If a defect-fix PR merged after the last deploy, redeploy before verifying.
- Rollback = Dokploy → Deployments → redeploy previous successful build
  (Dokploy keeps images); confirm rollback with the geo matrix again.

## Pitfalls (learned in this environment)

- Path `node` is v16 — always export PATH to Node 22 for npm/npx locally.
- Port 3000 on the SERVER may be occupied by leftover product containers;
  use a free port / Dokploy mapping, never reuse the product's port.
- `npm run start` binds 127.0.0.1 by design (local dev) — production start
  MUST bind 0.0.0.0 or Traefik cannot route to it.
- After deploy, re-verify BOTH locales render (PL diacritics are the
  canary for a stale build).
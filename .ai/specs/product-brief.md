# Open Triage — product brief

- Date: 2026-09-21 · Mode: existing · Owner: Kamil Mastalerz (maintainer)
- Coverage: 34 claims — 30 sourced (interview 0, data 0, document 18, product 12, benchmark 0), 0 synthetic, 4 assumed; 2 entries on the collection plan
- Definition of Ready signed by: Kamil Mastalerz (product owner, brief review 2026-09-21) — for the Now slice; brief-wide goals/metrics remain on the collection plan (Q03)
- Sources: README.md; PROTOTYPE.md; docs/production-readiness-plan.md; docs/architecture/ADR-0001-multi-tenancy.md; docs/architecture/ADR-0002-auth.md; docs/architecture/ADR-0003-vikingdb-integration.md; docs/architecture/ADR-0004-i18n.md; docs/architecture/SPEC-0001-mvp-architecture.md; docs/architecture/API-CONTRACT-OUTLINE.md; docs/architecture/DOCKER-COMPOSE-TOPOLOGY.md; BACKWARD_COMPATIBILITY.md; SDLC.md; .ai/specs/research/decisions/D01.md–D09.md; src/lib/types.ts; api/prisma/schema.prisma; api/src/worker/mailbox-config.ts

## Vision

An open-source, self-hostable alternative to Intercom — a shared team inbox for email support that small teams run themselves. `[DOCUMENT]` .ai/specs/research/decisions/D01.md (owner-confirmed 2026-09-21)

## Target group and stakeholders

- User (uses): Polish agencies' support teams — each agency is one tenant running its own shared mailbox(es) in the product. `[DOCUMENT]` .ai/specs/research/decisions/D09.md; docs/architecture/ADR-0001-multi-tenancy.md; ADR-0004-i18n.md
- Internal dogfooding: the maintainer's own team uses the prototype daily against a real mailbox; this is dogfooding, not the target segment. `[PRODUCT]` README.md ("Current state" — live IMAP/SMTP in use)
- Customer (pays): agencies are the intended customers; the business model (free repo vs. paid hosting vs. support) is undecided. `[ASSUMPTION]` A03
- Stakeholders (decides, blocks, operates): Kamil Mastalerz — maintainer, decides scope and roadmap. `[DOCUMENT]` .ai/specs/research/decisions/D01.md (owner line)

## Problems, with evidence

- Staff identity is simulated: the panel picks a staff member in the browser with no login, so the product cannot be exposed to an agency's network — agencies cannot use it as-is. `[PRODUCT]` README.md ("Identities are simulated; the demo does not implement authentication")
- All application state lives in one JSON file processed by a single process, so an agency deployment cannot run multiple replicas or survive host-level failure the way the readiness plan requires. `[PRODUCT]` docs/production-readiness-plan.md §1
- The repository has no CI: nothing automatically runs the validation gate on pull requests, so gating depends on discipline rather than the tracker. `[PRODUCT]` repository (no `.github/workflows/`; SDLC.md's gate is run manually)
- The support-inbox layout question (inbox / queue / board) is deliberately unresolved pending team evaluation, and the chosen-layout cleanup is blocked on it. `[DOCUMENT]` PROTOTYPE.md ("Verdict: to be filled in after team evaluation")

## Product and how it stands out

- What it is: a shared support inbox that receives real email over IMAP, assigns categories/priorities automatically via AI, drafts replies grounded in an approved knowledge base, and sends over SMTP with full threading. `[PRODUCT]` README.md
- What makes it different: open source and self-hostable (owner-stated positioning, D01). How that compares against Intercom concretely is pending the benchmark check (collection plan) — the differentiation claim is not yet evidence-backed against the named competitor.

## Goals and success criteria

On the collection plan — no measurable goals, primary metric, baseline, or thresholds exist in any source yet (Q03). What must not get worse: mail delivery guarantees (R01, R05) and team-data integrity in the prototype store.

## Scope

- **Now:** a CI workflow gating every pull request with the repository's six-command validation gate (D07) — the smallest change that completes one job end to end: changes get gated automatically.
- **Later:** Google OAuth sign-in for public access (D02, staged behind ADR-0002); PostgreSQL + S3 store with Postgres-based coordination (D03, D06); retrieval moved onto VikingDB (D08, per ADR-0003); prototype moved onto the api service (SPEC-0001); layout decision and cleanup (Q01).
- **Not doing:** see Non-goals.

## Domain glossary

Glossary terms come from src/lib/types.ts and api/prisma/schema.prisma. `[PRODUCT]`

| Term | Meaning | Owned by | Visible to |
|---|---|---|---|
| Mailbox | An IMAP/SMTP account whose conversations the team shares | product | staff of the tenant |
| Conversation | One threaded support case: messages, comments, drafts, assignment, status | product | staff of the tenant |
| Knowledge item | An approved document, versioned per mailbox, grounding AI drafts | product | staff of the tenant |
| Tenant | An isolated agency workspace in the api service | api (ADR-0001) | tenant members; platform admins |
| Presence | Ephemeral "who is looking" signal, expiring after 45 s | product | staff of the mailbox |

## Key flows

- Current state: inbound — the server polls IMAP every 30 s, deduplicates by UID/Message-ID, threads by References, auto-classifies via AI, panel refreshes; outbound — staff writes a reply (optionally from an AI draft), SMTP sends with shared From/Reply-To, identical MIME is copied to Sent and deduplicated by Message-ID. `[PRODUCT]` README.md
- Future state: the same flows re-hosted on PostgreSQL + S3 with Google sessions at public access and Postgres-based job coordination; AI knowledge retrieval moves onto VikingDB. Steps decided by D02/D03/D06/D08; untested until built. `[DOCUMENT]` docs/production-readiness-plan.md §2–4; ADR-0003

## Business rules

| Id | Rule | Applies to | Source | Owner | Status | Review by | Required path to change |
|---|---|---|---|---|---|---|---|
| R01 | Replies share the mailbox's From/Reply-To (never the individual), thread via Message-ID/In-Reply-To/References, and the Sent copy is deduplicated by Message-ID | all outgoing mail | `[PRODUCT]` README.md; BACKWARD_COMPATIBILITY.md §8 | Kamil Mastalerz | active | 2027-03-21 | superseding row approved by owner |
| R02 | AI never auto-sends and never auto-drafts: classification assigns category/priority only; a reply draft exists only after an explicit "Generate suggestion" | AI features | `[PRODUCT]` README.md | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| R03 | Credentials and keys never appear in state.json, API responses, logs, or browser storage: the OpenRouter key is stored with 0600 permissions, and api mailbox credentials are stored encrypted (`passwordEnc`, AES-256-GCM, SESSION_SECRET-derived) | secrets handling | `[PRODUCT]` README.md; api/src/worker/mailbox-config.ts; api/prisma/schema.prisma | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| R04 | Api data access is tenant-scoped through the Prisma middleware; no unscoped repositories | api service | `[PRODUCT]` docs/architecture/ADR-0001-multi-tenancy.md | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| R05 | An uncertain SMTP outcome is never retried automatically; only the Sent-copy write retries, and an uncertain send blocks further sends in that conversation until resolved | mail sending | `[PRODUCT]` README.md | Kamil Mastalerz | active | 2027-03-21 | superseding row |

## Non-goals

| Id | We are not building | Why | Owner | Status | Review by | Required path to change |
|---|---|---|---|---|---|---|
| N01 | Live chat and in-app widget channels — email inbox only for now | the working product is an email inbox; chat is a different channel surface | Kamil Mastalerz | active | 2027-03-21 | superseding row approved by owner |
| N02 | Analytics and reporting dashboards | no source demands them yet; focus is inbox correctness and self-hosting | Kamil Mastalerz | active | 2027-03-21 | superseding row |

## Decisions

| Id | Date | Decision | Why | Owner | Status | Review by | Required path to change |
|---|---|---|---|---|---|---|---|
| D01 | 2026-09-21 | Vision: open-source, self-hostable Intercom alternative (shared email inbox) | session decision | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| D02 | 2026-09-21 | Staged auth: e-mail+password (ADR-0002) rules the api MVP; Google OAuth via Better Auth applies at public access | ADR-0002 is newer and shipped; readiness plan §4 targets public access | Kamil Mastalerz | active | 2027-03-21 | superseding row; the public-access slice's design supersedes ADR-0002 explicitly |
| D03 | 2026-09-21 | PostgreSQL is the source of truth; S3 stores immutable MIME | readiness plan §1–2; ownership confirmed | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| D04 | 2026-09-21 | Clean start — no import of local JSON/.eml history | readiness plan §5; confirmed | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| D05 | 2026-09-21 | One permission level for admitted staff at launch | readiness plan §4; confirmed | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| D06 | 2026-09-21 | Postgres-based coordination; no Redis/K8s primitives in first version | readiness plan §3; confirmed | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| D07 | 2026-09-21 | CI gate is the first implemented slice; migration slices scheduled separately | session decision | Kamil Mastalerz | active | 2027-03-21 | superseding row |
| D08 | 2026-09-21 | VikingDB remains the AI knowledge-retrieval target; readiness plan clause is storage-only | session resolution of the ADR-0003 / plan §2 conflict | Kamil Mastalerz | active | 2027-03-21 | superseding row against ADR-0003 |
| D09 | 2026-09-21 | First users are Polish agencies (one per tenant); internal use is dogfooding | session resolution of the target-group conflict | Kamil Mastalerz | active | 2027-03-21 | superseding row |

## Riskiest assumptions

| Id | Assumption | Importance | Evidence today | If false | Smallest test | Owner | By when | Result |
|---|---|---|---|---|---|---|---|---|
| A01 | Self-hosting / open-source is what attracts agencies (vs. Intercom's SaaS convenience) | high | none | positioning fails; product competes on features alone | first conversation with an agency contact about deployment expectations | Kamil Mastalerz | — | untested |
| A02 | Email-only scope suffices for agencies' support workflow | medium | weak — the prototype was built email-only and is in daily email use | agencies need chat/social channels; N01 wrong | include the email-only boundary in the first agency conversation | Kamil Mastalerz | — | untested |
| A03 | A business model exists around the free repo (hosting, support, or paid features) | medium | none | the project stays a free-time repo with no revenue path | decide the model at the goals/metrics session (Q03/Q04) | Kamil Mastalerz | — | untested |

## Kill criteria

Not applicable in existing mode.

## Hypotheses to test

None — no persona walkthroughs or simulated interviews have been run.

## Open questions

| Id | Question | Blocking | Who can answer | Status |
|---|---|---|---|---|
| Q01 | Which support-inbox layout wins — inbox, queue, or board? | no | Kamil Mastalerz (team evaluation, per PROTOTYPE.md) | open |
| Q02 | When are the migration slices (D02-public/D03/D06/D08) scheduled to start? | no | Kamil Mastalerz | open |
| Q03 | What measurable goals and primary metric define success for the open-source release? | no | Kamil Mastalerz | open — collection plan |
| Q04 | What is the business model — free repo, paid hosting, or support? | no | Kamil Mastalerz | open |
| Q05 | Which agency gets the first walkthrough, and when? | no | Kamil Mastalerz | open |

## Definition of Ready addendum (existing)

For the Now slice (CI gate): migration and rollback path — additive `.github/workflows` file; rollback is deleting the file. Affected screens: none. Affected user groups: maintainers and contributors opening pull requests. The workflow must consume or mirror `validation.commands` from `.ai/agentic.config.json` — when that list changes, update the workflow and SDLC.md together (SDLC.md's drift rule), or the gate and CI diverge silently. For later slices: D03/D04 define the clean-start path, and BACKWARD_COMPATIBILITY.md §3 names the format-contract consequences.

## Collection plan

### Goals and success criteria

- **What we need to know:** the measurable business goal, primary metric with baseline/threshold/date, and what must not get worse beyond R01/R05.
- **Who can answer it:** Kamil Mastalerz (product owner).
- **How:** short interview — "what would make this worth the time spent, measured how, by when".
- **Owner and by when:** Kamil Mastalerz; next session (closes Q03, feeds A03).
- **Template:** `.ai/specs/research/templates/data-request.md` (metric definition) or a decision record once decided.

### Benchmark — Intercom

- **What we need to know:** what Intercom does well and where it falls short for self-hosting agencies, with link and date checked — before the differentiation claim is treated as evidence.
- **Who can answer it:** agent can collect; Kamil Mastalerz validates relevance.
- **How:** benchmark check of intercom.com (offering, pricing/model) plus one self-hosted competitor reference.
- **Owner and by when:** Kamil Mastalerz; before positioning is published.
- **Template:** `.ai/specs/research/templates/benchmark-check.md`

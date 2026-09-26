# Tenant email-gateway configuration

Id: SPEC-0002 · Status: in-review · Date: 2026-09-26 · Owner: Kamil Mastalerz
Depends on: ADR-0001 (multi-tenancy), SPEC-0001 (MVP architecture)
Tracked by: #10

## TLDR

A tenant (an agency) cannot connect an email address to watch incoming mail. The api service already has tenant-scoped `Mailbox` CRUD with encrypted credentials and per-mailbox IMAP polling, but the watched address is conflated with the IMAP login user, nothing stops two tenants from claiming the same address, outbound From falls back to the login user, sync failures are invisible, and the workspace UI has no mailbox section at all. The only working end-to-end flow is the single-tenant prototype's env-var config, hardcoded to `support@opentriage.com`. This spec adds a globally unique, tenant-owned **watch address** per mailbox, records sync health on the mailbox row, prefers that address for outbound From, and ships an "Email gateways" section in the workspace settings so a company configures its email gateway end to end without touching env vars.

## Problem statement

- **Who has it:** tenant admins of agency workspaces (D09). Today they have no way to bring their own support address into the product; only the maintainer, editing env vars per deployment, can connect mail — and only for one hardcoded address.
- **What hurts:** the multi-tenant api has `Mailbox` rows, verify and poll machinery (`api/src/mailboxes/`, `api/src/worker/mail-sync.service.ts`), but the surface is unusable as a product: no UI, identity mismatch, and a cross-tenant correctness hole — two tenants can configure the same address and each poller would import the same customer mail into different tenants.
- **Evidence:** prototype works but is single-tenant by design (`src/lib/mail-sync.ts:21-27` requires `TRIAGE_IMAP_USER == support@opentriage.com`; sync state keyed to the hardcoded `"test"` mailbox in `src/lib/store.ts:288-314`). The api `Mailbox` model (`api/prisma/schema.prisma:139-166`) carries only `@@index([tenantId])` — no unique constraint on any address. Outbound From is `mailbox.user ?? mailbox.host` (`api/src/conversations/conversations.controller.ts:279`). Workspace `/settings` renders only Profile + Language (`src/app/settings/page.tsx`).

## Proposed solution

1. Separate **public identity** from **login**: a new `Mailbox.address` holds the watched email address (normalized lowercase, unique across the whole platform). The IMAP login stays `Mailbox.user`. Gateway setups where the login differs from the published address (forwarding, provider logins) become first-class.
2. Make collisions impossible: platform-wide unique constraint on `address`, enforced at the API with a mapped `409 ADDRESS_TAKEN` error. A customer writing to one address can therefore only ever reach one tenant through the product.
3. Send from the published address: outbound From (header + envelope) prefers `address`, falling back to `user` for legacy rows — R01 semantics, now explicit.
4. Make health visible: `Mailbox.lastSyncError` (credential-free) written by the worker on failed polls, cleared on success; surfaced with `lastSyncAt` in the workspace snapshot.
5. Ship the UI: an admin-only "Email gateways" section in workspace `/settings` — list, add/edit form (address, IMAP connection, optional SMTP override, sent folder), verify button, delete with in-use protection — i18n'd in en/pl.

Inbound attribution does not change: a polled message belongs to the tenant of the mailbox it was polled from. With global address uniqueness that rule is now sound instead of merely implicit.

## Architecture

- **Unchanged:** worker fan-out (`poll-all` → per-mailbox jobs), UIDVALIDITY/lastUid cursors on the `Mailbox` row, `deliveryKey` idempotency, conversation threading, AI triage enqueue, send pipeline (compose → SMTP → commit → Sent-copy). ADR-0001 tenant scoping applies unchanged (R04).
- **Changed surfaces:** `api/prisma/schema.prisma` (two additive columns + unique index), `api/src/mailboxes/` (Zod schemas, normalization, uniqueness check, serialization), `api/src/worker/mail-sync.service.ts` (write/clear `lastSyncError`), `api/src/conversations/conversations.controller.ts` (From derivation), `api/src/workspace/workspace.controller.ts` (snapshot select gains `address`, `lastSyncError`), web workspace settings UI + `messages/en.json` / `messages/pl.json`.
- **Outbound identity:** `from: mailbox.address ?? mailbox.user ?? mailbox.host ?? ''` in the send-reply producer path; `outboundMessageId` keeps deriving its domain from that value, so backfilled rows behave byte-identically to today.
- **The prototype is untouched.** Its env-var flow remains the single-tenant dogfooding path (protected fallbacks, `BACKWARD_COMPATIBILITY.md`). The workspace UI backed by `/v1/mailboxes` is the multi-tenant surface.

## Data model

Additive changes to `Mailbox` only (`api/prisma/schema.prisma:139-166`); migration created with `api/scripts/create-migration.mjs`, never editing applied migrations (protected surface, `BACKWARD_COMPATIBILITY.md`):

```prisma
model Mailbox {
  // …existing fields…
  address       String? // watched/public address, normalized lowercase
  lastSyncError String? // credential-free reason of the last failed poll

  @@index([tenantId])
  @@unique([address]) // platform-wide: one address, one tenant
}
```

- `address` stays nullable at the DB level because `kind: channel` rows have no address yet and the backfill can leave collided legacy rows empty; the **API boundary** (Zod) requires it for every `kind: imap` create and update.
- **Backfill (in the same migration):** for existing rows with a login user, set `address = lower(user)` — oldest row first per distinct lower(user). Rows that would collide keep `address = null`; an admin sets their real addresses on next edit. Backfilled rows therefore keep today's From behavior exactly.
- No changes to `Conversation`, `Message`, or `TenantSetting`; no new models. Alias addresses (several watched addresses per mailbox, e.g. `support@` + `info@` into one inbox) are deliberately **deferred** — they would need a `MailboxAddress` child table with its own global uniqueness and a primary-address rule; see Open questions.

## API contracts

Extends the existing admin-of-tenant endpoints (`docs/architecture/API-CONTRACT-OUTLINE.md` § Mailboxes — updated in the same implementing PR):

- `POST /v1/mailboxes` — adds required-for-imap `address` (Zod email format, trimmed + lowercased). New mapped failure: `409 ADDRESS_TAKEN` with `{ code, message, details: { mailboxId } }`.
- `PATCH /v1/mailboxes/:id` — accepts `address` with the same validation and uniqueness check; changing the address of a mailbox that already has conversations is allowed (replies switch to the new address; historical threading is unaffected).
- `serializeMailbox` gains `address` (and `hasPassword`-style booleans stay as-is); passwords remain write-only, ever returned (R03).
- `POST /v1/mailboxes/:id/verify` — unchanged contract; it tests the **login** (`user` + password), not the address, which is exactly right for gateway setups.
- `GET /v1/workspace/state` — mailbox select gains `address` and `lastSyncError` so the whole team (not just admins) sees which address each inbox represents and whether it is healthy.
- Error-code additions to the global map: `ADDRESS_TAKEN` (409). Existing codes (`INVALID_CREDENTIALS`, `HOST_UNREACHABLE`, `NO_CREDENTIALS`, `VERIFY_NOT_APPLICABLE`, `MAILBOX_IN_USE`) are reused untouched.

## UI/UX

New **"Email gateways"** section on workspace `/settings` (admin/owner only; hidden for agents):

- **List:** name, address (primary identity, shown first), IMAP host, active toggle state, last sync time, sync-error badge with the credential-free reason from `lastSyncError`. Empty state explains the concept in one sentence with a single CTA ("Connect your first email address").
- **Add / edit form:** name; address; IMAP host / port / secure; login user; password (write-only — blank on edit means "unchanged", an explicit "clear credentials" affordance maps to `password: null`); optional SMTP override (host / port / secure) with a hint that replies need it; optional sent-folder override. Inline, field-level validation errors; `ADDRESS_TAKEN` maps to the address field with a pointer to the owning gateway's name when the API returns it.
- **Verify** button per row → success banner or mapped failure reason (`INVALID_CREDENTIALS` / `HOST_UNREACHABLE` / `NO_CREDENTIALS`), never credential content.
- **Delete** with a confirm dialog; `MAILBOX_IN_USE` surfaces as "This gateway has conversations — reassign or delete them first."
- Strings live under the existing `settings` namespace (new `settings.mailboxes.*` group) in **both** `messages/en.json` and `messages/pl.json`; `node scripts/check-i18n.mjs` stays green (ADR-0004).

## Edge cases

- **Address == login user** (direct-MX setup): the normal case; both fields hold the same value.
- **Address ≠ login user** (forwarding gateway, provider login): supported and verified — verify authenticates with the login, From uses the address.
- **Address changed after conversations exist:** allowed; old customer replies still thread (References/In-Reply-To matching is id-based, not address-based) and still import as long as they land in the same polled inbox.
- **Two gateways in one tenant** (one per brand): allowed; addresses differ, polls and cursors are already per-mailbox.
- **Same customer emailing two different tenants:** fine — conversations are per tenant/mailbox; nothing is shared.
- **Legacy row without address** (backfill collision): API requires setting one on the next edit; Until then From falls back to login user (today's behavior) and the UI shows an explicit "missing address" state.
- **SMTP override absent:** verify without the optional probe still validates IMAP; replies fail with the existing "SMTP not configured" path — the form hint steers admins to fill the override.
- **Suspended tenant / channel kind / live-chat:** unchanged, out of scope (N01).

## Risks

- **Protected surface:** the Prisma schema is protected (`BACKWARD_COMPATIBILITY.md`) — additive-only migration via `api/scripts/create-migration.mjs`; `migrate deploy` ordering in the container entrypoint is untouched.
- **Unique index on live data:** the deterministic backfill (oldest-wins, collisions left null) makes index creation safe; a naive `lower(user)` copy would not be. Deployments with genuinely duplicated inboxes are precisely the cross-tenant collision case the product must refuse to keep silent.
- **From-address drift:** none for existing rows (backfill sets address = login). New rows make the From explicit instead of accidental.
- **Deliverability (SPF/DKIM/DNS):** self-hosted operators own their DNS; setup guidance is documentation work, deliberately out of scope here.

## Business rules

No existing rule changes and no superseding rows are needed. The spec **implements** R01 (shared From/Reply-To from the mailbox — now from its address), R03 (credentials encrypted, never returned or logged — `lastSyncError` is credential-free by construction, tested), R04 (all access tenant-scoped; the uniqueness check is the one deliberately platform-wide read, by design), and operates within D09 and N01.

## Decisions in play

| Decision | Rationale |
|---|---|
| Watch address is a column on `Mailbox`, separate from the IMAP login | Public identity and credentials are different concerns; gateway setups need both modeled independently |
| Uniqueness is **global**, not per tenant | Two tenants watching one address would split the same customer mail across tenants — the failure is cross-tenant, so the constraint must be too |
| Inbound attribution stays mailbox-ownership-based; no recipient-header routing | Ownership is already how the worker attributes mail; uniqueness closes its soundness hole. Recipient routing would add header-parsing attack surface for no current gain |
| One watched address per mailbox in this slice; aliases deferred | Aliases need a child table + primary-address rule; the 90% case (one published support address) ships now |
| Prototype env-var flow untouched | Protected compatibility surface; single-tenant dogfooding is not the multi-tenant gap this spec closes |

## Acceptance criteria

| Id | Criterion | Verify | Covers | Tracked by |
|---|---|---|---|---|
| AC-01 | Given a tenant admin POSTs `/v1/mailboxes` with `kind: imap` and valid name, address, host, port, user, password, when the request completes, then the mailbox is persisted with the password stored only as `passwordEnc` and the response contains no password material. | test (`api/test/mailboxes-api.test.ts`, new) | R03 | #10 |
| AC-02 | Given an address submitted with uppercase letters or surrounding whitespace, when a mailbox is created or updated, then the stored and returned address is trimmed and lowercased. | test | — | #10 |
| AC-03 | Given a create or update whose address is not a syntactically valid email, when it is submitted, then the API answers 400 with Zod field details and nothing is persisted. | test | — | #10 |
| AC-04 | Given another mailbox in any tenant already holds address X, when a mailbox is created or updated with address X (case-insensitively), then the API answers 409 `ADDRESS_TAKEN` and the existing mailbox is unchanged. | test | — | #10 |
| AC-05 | Given a `kind: imap` create or update missing address, host, or user (or password on create), then the API answers 400; and given PATCH with `password: null`, then credentials are cleared, while a PATCH without `password` leaves them intact. | test | — | #10 |
| AC-06 | Given an admin of tenant A, when they PATCH, DELETE, or verify a mailbox belonging to tenant B, then they get 404 and no data about B's mailbox is revealed. | test | R04 | #10 |
| AC-07 | Given a member with the agent role, when they call any mutating `/v1/mailboxes` endpoint, then they get 403 — only tenant admins and owners configure gateways. | test | — | #10 |
| AC-08 | Given a message polled from mailbox M whose To/Cc headers do not include M's address, when it is imported, then the conversation is created under M's tenant and mailbox. | test | — | #10 |
| AC-09 | Given a mailbox with an address set, when a reply is sent, then the RFC From header and the SMTP envelope sender use the mailbox address (fallback: login user, for legacy rows without address). | test | R01 | #10 |
| AC-10 | Given a poll attempt that fails, when the worker finishes the attempt, then `Mailbox.lastSyncError` holds a credential-free reason; and given a later successful poll, then the field is cleared and `lastSyncAt` is updated. | test | R03 | #10 |
| AC-11 | Given a tenant admin opens workspace `/settings`, then an "Email gateways" section lists the tenant's mailboxes (name, address, host, active, last sync), shows an empty state with a create CTA when none exist, and is hidden from non-admin members. | e2e | — | #10 |
| AC-12 | Given the admin submits the add-gateway form, when the API accepts, then the gateway appears in the list; and when the API rejects with 400/409, then the mapped error (e.g. `ADDRESS_TAKEN`) is shown inline and the form input is preserved. | e2e | — | #10 |
| AC-13 | Given the admin clicks Verify on a gateway, then the UI shows success or the mapped failure reason (`INVALID_CREDENTIALS` / `HOST_UNREACHABLE` / `NO_CREDENTIALS`) without ever displaying stored credentials. | e2e | R03 | #10 |
| AC-14 | Given a gateway referenced by conversations, when the admin confirms deletion, then the UI surfaces `MAILBOX_IN_USE` and the gateway remains listed; and given an unreferenced gateway, then deletion after confirmation removes it. | e2e | — | #10 |
| AC-15 | Given any user-facing string introduced by this feature, when `node scripts/check-i18n.mjs` runs, then it passes with the keys present in both `messages/en.json` and `messages/pl.json`. | test (`node scripts/check-i18n.mjs`) | — | #10 |

## 📋 Phasing

- **Phase 1 — Data & API foundation** (schema/migration, mailboxes API, worker behavior, contract doc): AC-01–AC-10.
- **Phase 2 — Workspace UI** (settings section, i18n, e2e walks): AC-11–AC-15.

One tracking issue (#10) implements both phases in order; the maintainer may split phase 2 into its own issue without touching AC ids.

## Implementation Plan

1. **Step 1 — Schema & additive migration (AC-02, AC-04):** add `address` + `lastSyncError`, `@@unique([address])`, deterministic backfill from login user; migration via `api/scripts/create-migration.mjs`; regression coverage through the API tests of step 2.
2. **Step 2 — Mailboxes API (AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07):** Zod schemas (require address for imap, normalize, validate), `ADDRESS_TAKEN` mapping, serializer gains `address`; new `api/test/mailboxes-api.test.ts`; update `docs/architecture/API-CONTRACT-OUTLINE.md` § Mailboxes in the same PR.
3. **Step 3 — Worker identity & health (AC-08, AC-09, AC-10):** From preference `address ?? user ?? host` in the send path; `lastSyncError` write/clear in `pollMailbox`; inbound-attribution regression test with a mismatched recipient header.
4. **Step 4 — Workspace UI (AC-11, AC-12, AC-13, AC-14, AC-15):** snapshot select gains `address`/`lastSyncError`; "Email gateways" settings section (list / form / verify / delete) per the UI/UX section; `settings.mailboxes.*` strings in en+pl; `node scripts/check-i18n.mjs` green; e2e walk of the section.

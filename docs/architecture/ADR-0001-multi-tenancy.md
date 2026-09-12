# ADR-0001: Shared-schema multi-tenancy with tenant_id column

Status: accepted · 2026-09-12
Part of: SPEC-0001

## Context
open-triage is multi-tenant from day one (each customer agency/company = one tenant). We must choose an isolation strategy for PostgreSQL before the first migration. MVP scale target: hundreds of tenants, tens of thousands of conversations total.

## Options
1. **Shared schema, `tenant_id` column** — every tenant table carries `tenant_id`; queries always tenant-scoped. Cheapest to operate, one migration path, easy cross-tenant platform reporting.
2. **Schema-per-tenant** — a PostgreSQL schema per tenant; strong isolation, per-tenant backups/restore. Operational cost explodes with tenant count (migrations run N times, connection pooling complexity, catalog bloat).
3. **Database-per-tenant** — maximal isolation, only sensible for expensive enterprise tiers.

## Decision
Option 1. Enforcement in depth:
- Prisma middleware injects `tenant_id` from request context into every tenant-model query and rejects queries lacking tenant context.
- Every tenant-owned table has a composite index leading with `tenant_id`.
- `platform` tables (tenants list, platform admins) are the only unscoped ones.
- Postgres RLS is a defense-in-depth follow-up, not required for MVP correctness.

## Consequences
- One migration path; no per-tenant ops.
- A missing `tenant_id` filter is a data-leak bug — mitigated by the mandatory middleware, not by convention. Code review must treat any raw Prisma client escape hatch on tenant models as Critical.
- Cross-tenant queries allowed only in platform-admin code paths.

## Reversal trigger
A customer demands contractual per-tenant isolation or per-tenant backup/restore, or a single tenant grows to dominate table size — then move that tier to schema-per-tenant.
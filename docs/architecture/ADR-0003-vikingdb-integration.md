# ADR-0003: VikingDB as the AI knowledge base

Status: accepted · 2026-09-12
Part of: SPEC-0001

## Context
Triage quality (classification, suggested replies) depends on retrieval over tenant knowledge: FAQs, product docs, past resolved conversations. The platform stack already runs an OpenViking endpoint, and the task mandates VikingDB as the AI KB. MVP must stay self-hostable and keep tenant data isolated.

## Options
1. **VikingDB (OpenViking) as the KB service** — the backend stores `KnowledgeItem` rows in PostgreSQL and mirrors content into a per-tenant Viking collection; retrieval calls are scoped by tenant collection/prefix.
2. **pgvector in PostgreSQL** — one less service; embeddings and rows in one place, trivial tenant filtering.
3. **External vector SaaS (Pinecone etc.)** — fastest features, worst RODO/self-host story, vendor lock-in for an open-source product.

## Decision
Option 1, as mandated, with a strict contract so option 2 remains a swappable fallback:
- PostgreSQL `KnowledgeItem` is the source of truth; VikingDB is a derived index. Reindex command can rebuild it fully from Postgres.
- Access pattern encapsulated in one Nest module (`KnowledgeIndexService`) exposing `index(tenantId, item)` / `search(tenantId, query, k)`. No other code touches VikingDB directly.
- Tenant isolation = per-tenant collection naming (`tenant-{id}`), never shared-space metadata filters alone.
- Embeddings produced via the same OpenRouter provider used for LLM calls; model id stored per item batch so mixed-model indexes stay queryable.

## Consequences
- Extra running service in Docker Compose; acceptable since it's already part of the operator's stack.
- Mirror drift is a risk — mitigated by source-of-truth-in-Postgres + reindex.
- If OpenViking proves heavy for small self-host installs, `KnowledgeIndexService` gains a pgvector driver behind the same interface (flip condition below).

## Reversal trigger
Self-host setup friction or Viking endpoint instability in the first 5 pilot installs → pgvector driver, same interface, no spec change.
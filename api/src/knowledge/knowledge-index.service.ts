import { Injectable, Logger } from '@nestjs/common';

/**
 * ADR-0003: VikingDB access is encapsulated here and nowhere else.
 * PostgreSQL KnowledgeItem is the source of truth; VikingDB is a derived index.
 * Tenant isolation = per-tenant collection naming (`tenant-{id}`).
 * Reindex can fully rebuild the index from Postgres.
 *
 * Contract: index(tenantId, item) / search(tenantId, query, k) / reindex(tenantId).
 * Swap-in fallback (reversal trigger): pgvector driver behind this same interface.
 */
export interface IndexableItem {
  id: string;
  title: string;
  content: string;
}

export interface SearchHit {
  id: string;
  title: string;
  score: number;
}

@Injectable()
export class KnowledgeIndexService {
  private readonly logger = new Logger(KnowledgeIndexService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.VIKINGDB_URL ?? 'http://vikingdb:1933';
  }

  private collection(tenantId: string): string {
    return `tenant-${tenantId}`;
  }

  private async call(path: string, body: unknown): Promise<unknown | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`VikingDB ${path} -> ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      // ADR-0003: Viking instability must not break core triage flows.
      this.logger.warn(`VikingDB ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async index(tenantId: string, item: IndexableItem): Promise<boolean> {
    const result = await this.call('/v1/collections/documents/upsert', {
      collection: this.collection(tenantId),
      documents: [{ id: item.id, text: `${item.title}\n\n${item.content}`, metadata: { title: item.title } }],
    });
    return result !== null;
  }

  async delete(tenantId: string, itemId: string): Promise<boolean> {
    const result = await this.call('/v1/collections/documents/delete', {
      collection: this.collection(tenantId),
      ids: [itemId],
    });
    return result !== null;
  }

  async search(tenantId: string, query: string, k = 5): Promise<SearchHit[]> {
    const result = (await this.call('/v1/collections/documents/search', {
      collection: this.collection(tenantId),
      query,
      top_k: k,
    })) as { hits?: { id: string; title?: string; score?: number }[] } | null;
    if (!result?.hits) return [];
    return result.hits.map((h) => ({ id: h.id, title: h.title ?? '', score: h.score ?? 0 }));
  }

  /** Rebuild the whole tenant collection from Postgres source of truth. */
  async reindex(tenantId: string, items: IndexableItem[]): Promise<{ indexed: number; ok: boolean }> {
    // Fresh collection: delete then upsert everything
    await this.call('/v1/collections/delete', { collection: this.collection(tenantId) });
    await this.call('/v1/collections/create', { collection: this.collection(tenantId) });
    if (items.length > 0) {
      const ok = await this.call('/v1/collections/documents/upsert', {
        collection: this.collection(tenantId),
        documents: items.map((i) => ({ id: i.id, text: `${i.title}\n\n${i.content}`, metadata: { title: i.title } })),
      });
      if (ok === null) return { indexed: 0, ok: false };
    }
    return { indexed: items.length, ok: true };
  }
}

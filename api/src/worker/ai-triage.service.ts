import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { KnowledgeIndexService } from '../knowledge/knowledge-index.service';
import { Producer } from './producer';
import { PRODUCER } from './producer.module';
import {
  completeAiClassification,
  completeAiDraft,
  OpenRouterError,
  type AiUsage,
} from './openrouter-client';

const DEFAULT_MODEL = 'z-ai/glm-5.3';

/**
 * AI triage orchestration per ADR-0003: VikingDB retrieval is delegated to
 * KnowledgeIndexService (the only VikingDB entry point); PostgreSQL
 * KnowledgeItem stays the source of truth; OpenRouter key comes from env
 * OPENROUTER_API_KEY, model from TenantSetting.aiModel → GlobalSetting('ai')
 * → DEFAULT_MODEL. AI results are suggestions for humans — classification
 * lands on Conversation aiCategory/aiPriority/aiReason, drafts on aiDraft*
 * columns; drafts are never auto-sent.
 */
@Injectable()
export class AiTriageService {
  private readonly logger = new Logger(AiTriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeIndex: KnowledgeIndexService,
  ) {}

  private async aiSettings(tenantId: string): Promise<{ apiKey: string; model: string } | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    // Per-tenant model override (TenantSetting.aiModel), else GlobalSetting, else default.
    const tenantSetting = await this.prisma.tenantSetting.findUnique({
      where: { tenantId },
      select: { aiModel: true },
    });
    const globalRow = await this.prisma.globalSetting.findUnique({ where: { key: 'ai' } });
    const globalModel =
      globalRow?.value && typeof globalRow.value === 'object' && 'model' in globalRow.value
        ? String((globalRow.value as Record<string, unknown>).model)
        : null;
    const model = tenantSetting?.aiModel || globalModel || DEFAULT_MODEL;
    return { apiKey, model };
  }

  /** Latest messages as classification/draft context (allowlisted fields only —
   * no comments, drafts, or staff notes ever leave the tenant boundary). */
  private async buildContext(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        tenantId: true,
        subject: true,
        category: true,
        status: true,
        customerEmail: true,
        messages: {
          orderBy: { sentAt: 'asc' },
          select: { direction: true, authorType: true, authorName: true, body: true, sentAt: true },
        },
      },
    });
    if (!conversation) return null;
    const emails = conversation.messages.slice(-12).map((m) => ({
      direction: m.direction,
      from: m.authorName,
      createdAt: m.sentAt,
      body: m.body.slice(0, 6000),
    }));
    return {
      conversation: {
        id: conversation.id,
        subject: conversation.subject,
        category: conversation.category,
        status: conversation.status,
      },
      emails,
    };
  }

  async classify(tenantId: string, conversationId: string): Promise<void> {
    const settings = await this.aiSettings(tenantId);
    if (!settings) {
      this.logger.warn(`classify skipped (no OPENROUTER_API_KEY): conversation ${conversationId}`);
      return;
    }
    const context = await this.buildContext(conversationId);
    if (!context) return;
    try {
      const result = await completeAiClassification(settings.apiKey, settings.model, context);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          aiCategory: result.category,
          aiPriority: result.priority,
          aiReason: result.reason,
        },
      });
      this.logger.log(
        `classified ${conversationId}: ${result.category}/${result.priority}${result.usage?.totalTokens ? ` (${result.usage.totalTokens} tokens)` : ''}`,
      );
    } catch (error) {
      this.logAiError('classify', conversationId, error);
    }
  }

  /** Draft suggestion over VikingDB-retrieved knowledge (ADR-0003). */
  async draft(tenantId: string, conversationId: string, userId: string): Promise<void> {
    const settings = await this.aiSettings(tenantId);
    if (!settings) {
      this.logger.warn(`draft skipped (no OPENROUTER_API_KEY): conversation ${conversationId}`);
      return;
    }
    const context = await this.buildContext(conversationId);
    if (!context) return;

    const query = `${context.conversation.subject} ${context.emails.at(-1)?.body ?? ''}`;
    const documents = await this.loadDocuments(tenantId, query);
    try {
      const result = await completeAiDraft(settings.apiKey, settings.model, context, documents);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          aiDraftText: result.text,
          aiDraftSourceIds: result.sourceIds,
          aiDraftModel: settings.model,
          aiDraftAt: new Date(),
        },
      });
      this.logger.log(
        `draft ${result.needsHuman ? 'needsHuman' : 'ready'} for ${conversationId} by ${userId}${result.usage?.totalTokens ? ` (${result.usage.totalTokens} tokens)` : ''}`,
      );
    } catch (error) {
      this.logAiError('draft', conversationId, error);
    }
  }

  /** Resolve retrieval hits to knowledge items that still exist in Postgres. */
  private async loadDocuments(
    tenantId: string,
    query: string,
  ): Promise<{ id: string; title: string; body: string }[]> {
    const hits = await this.knowledgeIndex.search(tenantId, query, 5);
    if (!hits.length) return [];
    const items = await this.prisma.knowledgeItem.findMany({
      where: { tenantId, id: { in: hits.map((h) => h.id) } },
      select: { id: true, title: true, content: true },
    });
    // Keep retrieval order; content trimmed for the prompt.
    return hits
      .map((hit) => {
        const item = items.find((i) => i.id === hit.id);
        return item ? { id: item.id, title: item.title, body: item.content.slice(0, 8000) } : null;
      })
      .filter((doc): doc is { id: string; title: string; body: string } => doc !== null);
  }

  private logAiError(operation: string, conversationId: string, error: unknown): void {
    if (error instanceof OpenRouterError) {
      this.logger.warn(`AI ${operation} for ${conversationId}: ${error.code} — ${error.message}`);
    } else {
      this.logger.error(
        `AI ${operation} for ${conversationId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
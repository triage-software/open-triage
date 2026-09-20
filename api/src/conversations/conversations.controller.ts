import { randomUUID } from 'node:crypto';
import {
  Controller, Get, Post, Put, Patch, Body, Param, Query, Req, Inject,
  UseGuards, NotFoundException, ParseUUIDPipe, ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { TenantRoleGuard, MinRole } from '../auth/guards';
import { Producer } from '../worker/producer';
import { PRODUCER } from '../worker/producer.module';
import { AiTriageService } from '../worker/ai-triage.service';

const STATUSES = ['open', 'in_progress', 'pending', 'resolved'] as const;

const patchConversationSchema = z.object({
  status: z.enum(STATUSES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  category: z.string().min(1).max(80).optional(),
});

const commentSchema = z.object({ body: z.string().min(1).max(10000) });

const sendMessageSchema = z
  .object({
    body: z.string().min(1).max(10000),
    send: z.boolean().default(true),
  })
  .strict();

const draftSchema = z
  .object({
    mode: z.enum(['reply', 'comment']),
    text: z.string().max(30000),
    baseRevision: z.number().int().nonnegative().default(0),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

@Controller('v1/conversations')
@UseGuards(TenantRoleGuard)
@MinRole('agent')
export class ConversationsController {
  constructor(
    private prisma: PrismaService,
    @Inject(PRODUCER) private producer: Producer,
    private ai: AiTriageService,
  ) {}

  private tenantId(req: Request): string {
    return req.user!.tenantId;
  }

  /** GET /conversations?status=&assignee=&q=&limit=&cursor= — tenant-scoped (ADR-0001). */
  @Get()
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const tenantId = this.tenantId(req);
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1), 100);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as 'open' } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(q ? { OR: [{ subject: { contains: q, mode: 'insensitive' as const } }, { customerEmail: { contains: q, mode: 'insensitive' as const } }] } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
    });

    const hasMore = conversations.length > limit;
    const page = hasMore ? conversations.slice(0, limit) : conversations;
    return {
      data: page.map((c) => ({
        id: c.id,
        subject: c.subject,
        status: c.status,
        priority: c.priority,
        category: c.category,
        customerEmail: c.customerEmail,
        assignee: c.assignee,
        messageCount: c._count.messages,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
      })),
      cursor: hasMore ? page[page.length - 1]?.id : null,
    };
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const c = await this.prisma.conversation.findFirst({
      where: { id, tenantId: this.tenantId(req) },
      include: {
        messages: { orderBy: { sentAt: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, name: true, email: true } } } },
        assignee: { select: { id: true, name: true, email: true } },
        mailbox: { select: { id: true, name: true, user: true, kind: true, host: true, active: true } },
      },
    });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { data: c };
  }

  @Patch(':id')
  async patch(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const data = patchConversationSchema.parse(body);
    const tenantId = this.tenantId(req);
    const existing = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, priority: true, assigneeId: true, subject: true },
    });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });

    const updated = await this.prisma.conversation.update({
      where: { id },
      // lastMessageAt drives list ordering — treat triage changes as activity.
      data: { ...data, lastMessageAt: new Date() },
    });

    // Workspace notifications (prototype parity): assignment notifies the new
    // assignee; escalation to urgent notifies the rest of the team.
    const actorId = req.user!.userId;
    const notifies: { userId: string; type: string; title: string }[] = [];
    if (data.assigneeId !== undefined && data.assigneeId && data.assigneeId !== existing.assigneeId && data.assigneeId !== actorId) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: data.assigneeId, tenantId, deactivatedAt: null },
        select: { name: true, email: true },
      });
      if (assignee) {
        notifies.push({
          userId: data.assigneeId,
          type: 'assignment',
          title: `Rozmowa przypisana: ${assignee.name ?? assignee.email}`,
        });
      }
    }
    if (data.priority === 'urgent' && existing.priority !== 'urgent') {
      const team = await this.prisma.user.findMany({
        where: { tenantId, deactivatedAt: null },
        select: { id: true },
      });
      for (const member of team) {
        if (member.id !== actorId) {
          notifies.push({ userId: member.id, type: 'urgent', title: 'Zgłoszenie krytyczne' });
        }
      }
    }
    if (notifies.length) {
      await this.prisma.notification.createMany({
        data: notifies.map((n) => ({
          tenantId,
          userId: n.userId,
          conversationId: id,
          type: n.type,
          title: n.title,
          body: updated.subject,
        })),
      });
    }

    return { data: { id: updated.id, status: updated.status, priority: updated.priority, assigneeId: updated.assigneeId, category: updated.category } };
  }

  /**
   * PUT /conversations/:id/draft — CAS save of the agent's composer draft
   * (prototype parity: one draft per conversation+user+mode, monotonic
   * version; 409 DRAFT_CONFLICT when another tab bumped it first).
   */
  @Put(':id/draft')
  async saveDraft(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = draftSchema.parse(body);
    const tenantId = this.tenantId(req);
    const existingConversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existingConversation) throw new NotFoundException({ code: 'NOT_FOUND' });

    const unique = { conversationId: id, userId: req.user!.userId, mode: data.mode };
    const current = await this.prisma.conversationDraft.findUnique({ where: { conversationId_userId_mode: unique } });
    if (current && current.tenantId !== tenantId) throw new NotFoundException({ code: 'NOT_FOUND' });
    if ((current?.version ?? 0) !== data.expectedVersion) {
      throw new ConflictException({ code: 'DRAFT_CONFLICT' });
    }
    const draft = await this.prisma.conversationDraft.upsert({
      where: { conversationId_userId_mode: unique },
      create: { ...unique, tenantId, text: data.text, version: 1, baseRevision: data.baseRevision },
      update: { text: data.text, version: data.expectedVersion + 1, baseRevision: data.baseRevision },
      select: { version: true, updatedAt: true },
    });
    return { data: draft };
  }

  /** Clears a composer draft after its content was sent (text emptied, version
   *  bumped so open editors resync instead of resurrecting stale text). */
  private async clearDraft(tenantId: string, conversationId: string, userId: string, mode: 'reply' | 'comment') {
    const unique = { conversationId, userId, mode };
    const current = await this.prisma.conversationDraft.findUnique({ where: { conversationId_userId_mode: unique } });
    if (!current || current.tenantId !== tenantId) return current?.version ?? 0;
    const next = await this.prisma.conversationDraft.update({
      where: { conversationId_userId_mode: unique },
      data: { text: '', version: { increment: 1 }, baseRevision: 0 },
      select: { version: true },
    });
    return next.version;
  }

  @Post(':id/comments')
  async addComment(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const data = commentSchema.parse(body);
    const existing = await this.prisma.conversation.findFirst({
      where: { id, tenantId: this.tenantId(req) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    const comment = await this.prisma.comment.create({
      data: { conversationId: id, tenantId: this.tenantId(req), userId: req.user!.userId, body: data.body },
    });
    const draftVersion = await this.clearDraft(this.tenantId(req), id, req.user!.userId, 'comment');
    return { data: { ...comment, draftVersion } };
  }

  /**
   * POST /conversations/:id/messages {body, send:true} — agent reply via the
   * worker's SMTP send job. Idempotent per deliveryKey; the Sent-folder copy
   * is handled by the worker after delivery. Returns 202 (accepted for
   * delivery), not a synchronous SMTP result.
   */
  @Post(':id/messages')
  @MinRole('agent')
  async sendMessage(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const data = sendMessageSchema.parse(body);
    const tenantId = this.tenantId(req);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        mailbox: true,
        messages: { orderBy: { sentAt: 'desc' }, take: 12, select: { messageId: true } },
      },
    });
    if (!conversation) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (data.send && !this.producer.available) {
      throw new ServiceUnavailableException({ code: 'MAIL_QUEUE_UNAVAILABLE' });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, name: true, email: true },
    });

    const inReplyTo = conversation.messages.find((m) => m.messageId)?.messageId ?? null;
    const references = conversation.messages
      .map((m) => m.messageId)
      .filter((value): value is string => Boolean(value));
    const deliveryKey = `send-${randomUUID()}`;

    const payload = {
      deliveryKey,
      tenantId,
      conversationId: conversation.id,
      messageId: deliveryKey,
      inReplyTo,
      references,
      from: conversation.mailbox.user ?? conversation.mailbox.host ?? '',
      fromName: user?.name ?? null,
      to: conversation.customerEmail,
      subject: conversation.subject,
      body: data.body.trim(),
      userId: req.user!.userId,
      date: new Date().toISOString(),
    };

    if (data.send) {
      const enqueued = await this.producer.enqueueSendReply(payload);
      if (!enqueued) throw new ServiceUnavailableException({ code: 'MAIL_QUEUE_UNAVAILABLE' });
      const draftVersion = await this.clearDraft(tenantId, conversation.id, req.user!.userId, 'reply');
      return { data: { ok: true, deliveryKey, status: 'queued', draftVersion } };
    }
    // send:false — store the message without delivery (no SMTP side effect).
    await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: 'out',
        authorType: 'agent',
        authorUserId: req.user!.userId,
        authorName: user?.name ?? null,
        body: data.body,
        deliveryKey,
      },
    });
    const draftVersion = await this.clearDraft(tenantId, conversation.id, req.user!.userId, 'reply');
    return { data: { ok: true, deliveryKey, status: 'stored', draftVersion } };
  }

  /**
   * POST /conversations/:id/ai-draft — AI reply suggestion (never auto-sent).
   * Synchronous: the OpenRouter call runs in-request; the result is persisted
   * on the conversation (aiDraft*) and returned to the caller.
   */
  @Post(':id/ai-draft')
  @MinRole('agent')
  async aiDraft(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = this.tenantId(req);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException({ code: 'NOT_FOUND' });

    await this.ai.draft(tenantId, conversation.id, req.user!.userId);
    const updated = await this.prisma.conversation.findUnique({
      where: { id },
      select: {
        aiDraftText: true,
        aiDraftSourceIds: true,
        aiDraftModel: true,
        aiDraftAt: true,
        aiCategory: true,
        aiPriority: true,
        aiReason: true,
      },
    });
    const needsHuman =
      !updated?.aiDraftText || updated.aiDraftText.trim().length === 0;
    return {
      data: {
        ok: true,
        draft: {
          text: updated?.aiDraftText ?? '',
          sourceIds: updated?.aiDraftSourceIds ?? [],
          needsHuman,
          model: updated?.aiDraftModel ?? null,
          generatedAt: updated?.aiDraftAt ?? null,
        },
        classification: {
          category: updated?.aiCategory ?? null,
          priority: updated?.aiPriority ?? null,
          reason: updated?.aiReason ?? null,
        },
      },
    };
  }
}
import { randomUUID } from 'node:crypto';
import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, Inject,
  UseGuards, NotFoundException, ParseUUIDPipe, ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { TenantRoleGuard, MinRole } from '../auth/guards';
import { Producer } from '../worker/producer';
import { PRODUCER } from '../worker/producer.module';
import { AiTriageService } from '../worker/ai-triage.service';

const patchConversationSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

const commentSchema = z.object({ body: z.string().min(1).max(10000) });

const sendMessageSchema = z
  .object({
    body: z.string().min(1).max(10000),
    send: z.boolean().default(true),
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
        ...(status && ['open', 'pending', 'resolved'].includes(status) ? { status: status as 'open' } : {}),
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
        mailbox: { select: { id: true, name: true } },
      },
    });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { data: c };
  }

  @Patch(':id')
  async patch(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const data = patchConversationSchema.parse(body);
    const existing = await this.prisma.conversation.findFirst({
      where: { id, tenantId: this.tenantId(req) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    const updated = await this.prisma.conversation.update({ where: { id }, data });
    return { data: { id: updated.id, status: updated.status, priority: updated.priority, assigneeId: updated.assigneeId } };
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
    return { data: comment };
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
      return { data: { ok: true, deliveryKey, status: 'queued' } };
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
    return { data: { ok: true, deliveryKey, status: 'stored' } };
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
import { Controller, Get, Post, Body, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { TenantRoleGuard, MinRole } from '../auth/guards';

const readNotificationsSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(500).default([]),
    all: z.boolean().default(false),
  })
  .strict();

/**
 * Workspace BFF state (prototype-at-root): one round-trip feeding the shared
 * support workspace view-models. Every query is tenant-scoped (ADR-0001);
 * drafts and notifications are additionally scoped to the session user.
 */
@Controller('v1/workspace')
@UseGuards(TenantRoleGuard)
@MinRole('agent')
export class WorkspaceController {
  constructor(private prisma: PrismaService) {}

  @Get('state')
  async state(@Req() req: Request) {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const [users, mailboxes, conversations, drafts, notifications, knowledge, tenantSetting, globalAi] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { tenantId, deactivatedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, email: true, role: true, locale: true },
        }),
        this.prisma.mailbox.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, kind: true, host: true, user: true, active: true, lastSyncAt: true },
        }),
        this.prisma.conversation.findMany({
          where: { tenantId },
          orderBy: { lastMessageAt: 'desc' },
          take: 100,
          include: {
            assignee: { select: { id: true, name: true } },
            _count: { select: { messages: true, comments: true } },
            messages: {
              orderBy: { sentAt: 'desc' },
              take: 1,
              select: { body: true, direction: true, authorType: true, authorName: true, sentAt: true },
            },
          },
        }),
        this.prisma.conversationDraft.findMany({
          where: { tenantId, userId },
          select: { conversationId: true, mode: true, text: true, version: true, baseRevision: true, updatedAt: true },
        }),
        this.prisma.notification.findMany({
          where: { tenantId, userId },
          orderBy: { createdAt: 'desc' },
          take: 60,
        }),
        this.prisma.knowledgeItem.findMany({
          where: { tenantId },
          orderBy: { updatedAt: 'desc' },
          include: { versions: { orderBy: { version: 'asc' } } },
        }),
        this.prisma.tenantSetting.findUnique({
          where: { tenantId },
          select: { aiModel: true, aiModelUpdatedAt: true },
        }),
        this.prisma.globalSetting.findUnique({ where: { key: 'ai' } }),
      ]);

    const globalModel =
      globalAi?.value && typeof globalAi.value === 'object' && 'model' in globalAi.value
        ? String((globalAi.value as Record<string, unknown>).model)
        : null;

    return {
      data: {
        users,
        mailboxes,
        conversations: conversations.map((c) => ({
          id: c.id,
          subject: c.subject,
          status: c.status,
          priority: c.priority,
          category: c.category,
          customerEmail: c.customerEmail,
          assigneeId: c.assigneeId,
          assigneeName: c.assignee?.name ?? null,
          mailboxId: c.mailboxId,
          createdAt: c.createdAt,
          lastMessageAt: c.lastMessageAt,
          messageCount: c._count.messages,
          commentCount: c._count.comments,
          lastMessage: c.messages[0]
            ? {
                body: c.messages[0].body,
                direction: c.messages[0].direction,
                authorType: c.messages[0].authorType,
                authorName: c.messages[0].authorName,
                sentAt: c.messages[0].sentAt,
              }
            : null,
          aiCategory: c.aiCategory,
          aiPriority: c.aiPriority,
          aiReason: c.aiReason,
          aiDraftText: c.aiDraftText,
          aiDraftSourceIds: c.aiDraftSourceIds,
          aiDraftModel: c.aiDraftModel,
          aiDraftAt: c.aiDraftAt,
          lastMessageSentAt: c.messages[0]?.sentAt ?? c.lastMessageAt,
        })),
        drafts,
        notifications,
        knowledge: knowledge.map((k) => ({
          id: k.id,
          mailboxId: k.mailboxId,
          category: k.category,
          status: k.status,
          title: k.title,
          updatedAt: k.updatedAt,
          versions: k.versions.map((v) => ({
            version: v.version,
            title: v.title,
            content: v.content,
            status: v.status,
            userId: v.userId,
            createdAt: v.createdAt,
          })),
        })),
        aiSettings: {
          configured: Boolean(process.env.OPENROUTER_API_KEY),
          model: tenantSetting?.aiModel || globalModel || 'z-ai/glm-5.3',
          version: tenantSetting?.aiModelUpdatedAt?.getTime() ?? 0,
        },
      },
    };
  }

  /** POST /workspace/notifications-read {ids}|{all} — mark my notifications read. */
  @Post('notifications-read')
  @HttpCode(200)
  async readNotifications(@Req() req: Request, @Body() body: unknown) {
    const data = readNotificationsSchema.parse(body ?? {});
    const where = {
      tenantId: req.user!.tenantId,
      userId: req.user!.userId,
      readAt: null,
      ...(data.all ? {} : { id: { in: data.ids } }),
    };
    const result = await this.prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    return { data: { ok: true, count: result.count } };
  }
}

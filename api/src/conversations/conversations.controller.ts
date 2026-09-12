import {
  Controller, Get, Post, Patch, Body, Param, Query, Req,
  UseGuards, NotFoundException, ForbiddenException, ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { TenantRoleGuard, MinRole } from '../auth/guards';

const patchConversationSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

const commentSchema = z.object({ body: z.string().min(1).max(10000) });

@Controller('v1/conversations')
@UseGuards(TenantRoleGuard)
@MinRole('agent')
export class ConversationsController {
  constructor(private prisma: PrismaService) {}

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
}

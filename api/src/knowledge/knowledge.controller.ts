import {
  Controller, Get, Post, Patch, Delete, Body, Param, Req,
  UseGuards, NotFoundException, ConflictException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { TenantRoleGuard, MinRole } from '../auth/guards';
import { KnowledgeIndexService } from './knowledge-index.service';

const itemSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  source: z.string().max(80).default('manual'),
  mailboxId: z.string().max(100).optional(),
  category: z.string().max(80).optional(),
});

/** Workspace increment: versioned edits with review status. `expectedVersion`
 *  is optional for the legacy MVP PATCH (last-write-wins); when present it is
 *  a CAS guard against another tab's edit (409 DOCUMENT_CONFLICT). */
const updateSchema = itemSchema.partial().extend({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

@Controller('v1/knowledge-items')
@UseGuards(TenantRoleGuard)
export class KnowledgeController {
  constructor(
    private prisma: PrismaService,
    private index: KnowledgeIndexService,
  ) {}

  @Get()
  @MinRole('agent')
  async list(@Req() req: Request) {
    const items = await this.prisma.knowledgeItem.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { updatedAt: 'desc' },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
    return { data: items };
  }

  @Get(':id')
  @MinRole('agent')
  async get(@Req() req: Request, @Param('id') id: string) {
    const item = await this.prisma.knowledgeItem.findFirst({
      where: { id, tenantId: req.user!.tenantId },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { data: item };
  }

  @Post()
  @MinRole('admin')
  async create(@Req() req: Request, @Body() body: unknown) {
    const data = itemSchema.parse(body);
    const item = await this.prisma.knowledgeItem.create({
      data: {
        tenantId: req.user!.tenantId,
        title: data.title,
        content: data.content,
        source: data.source,
        mailboxId: data.mailboxId ?? null,
        category: data.category ?? null,
        status: 'pending',
        versions: {
          create: {
            tenantId: req.user!.tenantId,
            version: 1,
            title: data.title,
            content: data.content,
            status: 'pending',
            userId: req.user!.userId,
          },
        },
      },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
    // Fire-and-forget mirror (ADR-0003); Postgres row is the source of truth.
    void this.index.index(req.user!.tenantId, item);
    return { data: item };
  }

  @Patch(':id')
  @MinRole('admin')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const data = updateSchema.parse(body);
    const tenantId = req.user!.tenantId;
    const existing = await this.prisma.knowledgeItem.findFirst({
      where: { id, tenantId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });

    const latest = existing.versions[0];
    const nextVersion = (latest?.version ?? 0) + 1;
    if (data.expectedVersion !== undefined && latest?.version !== data.expectedVersion) {
      throw new ConflictException({ code: 'DOCUMENT_CONFLICT' });
    }

    const title = data.title ?? existing.title;
    const content = data.content ?? existing.content;
    const status = data.status ?? existing.status;

    const item = await this.prisma.knowledgeItem.update({
      where: { id },
      data: {
        title,
        content,
        status,
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.mailboxId !== undefined ? { mailboxId: data.mailboxId } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        versions: {
          create: {
            tenantId: req.user!.tenantId,
            version: nextVersion,
            title,
            content,
            status,
            userId: req.user!.userId,
          },
        },
      },
      include: { versions: { orderBy: { version: 'asc' } } },
    });
    void this.index.index(tenantId, item);
    return { data: item };
  }

  @Delete(':id')
  @MinRole('admin')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const existing = await this.prisma.knowledgeItem.findFirst({
      where: { id, tenantId: req.user!.tenantId },
    });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.prisma.$transaction([
      this.prisma.knowledgeItemVersion.deleteMany({ where: { itemId: id, tenantId: req.user!.tenantId } }),
      this.prisma.knowledgeItem.delete({ where: { id } }),
    ]);
    void this.index.delete(req.user!.tenantId, id);
    return { data: { ok: true } };
  }

  /** POST /knowledge-items/reindex — rebuild Viking collection from Postgres (admin). */
  @Post('reindex')
  @MinRole('admin')
  async reindex(@Req() req: Request) {
    const items = await this.prisma.knowledgeItem.findMany({
      where: { tenantId: req.user!.tenantId },
      select: { id: true, title: true, content: true },
    });
    const result = await this.index.reindex(req.user!.tenantId, items);
    return { data: result };
  }
}

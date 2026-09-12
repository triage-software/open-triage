import {
  Controller, Get, Post, Patch, Delete, Body, Param, Req,
  UseGuards, NotFoundException,
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
      select: { id: true, title: true, source: true, createdAt: true, updatedAt: true },
    });
    return { data: items };
  }

  @Get(':id')
  @MinRole('agent')
  async get(@Req() req: Request, @Param('id') id: string) {
    const item = await this.prisma.knowledgeItem.findFirst({
      where: { id, tenantId: req.user!.tenantId },
    });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { data: item };
  }

  @Post()
  @MinRole('admin')
  async create(@Req() req: Request, @Body() body: unknown) {
    const data = itemSchema.parse(body);
    const item = await this.prisma.knowledgeItem.create({
      data: { ...data, tenantId: req.user!.tenantId },
    });
    // Fire-and-forget mirror (ADR-0003); Postgres row is the source of truth.
    void this.index.index(req.user!.tenantId, item);
    return { data: item };
  }

  @Patch(':id')
  @MinRole('admin')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const data = itemSchema.partial().parse(body);
    const existing = await this.prisma.knowledgeItem.findFirst({
      where: { id, tenantId: req.user!.tenantId },
    });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    const item = await this.prisma.knowledgeItem.update({ where: { id }, data });
    void this.index.index(req.user!.tenantId, item);
    return { data: item };
  }

  @Delete(':id')
  @MinRole('admin')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const existing = await this.prisma.knowledgeItem.findFirst({
      where: { id, tenantId: req.user!.tenantId },
    });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.prisma.knowledgeItem.delete({ where: { id } });
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

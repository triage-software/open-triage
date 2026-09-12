import {
  Controller, Get, Patch, Put, Body, Param, Query, Req,
  UseGuards, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { PlatformAdminGuard } from '../auth/guards';

const patchTenantSchema = z.object({
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  suspended: z.boolean().optional(),
  name: z.string().min(2).max(120).optional(),
});

const putSettingsSchema = z.record(z.string(), z.unknown());

// Global AI settings keys (SPEC-0001: global AI provider config)
const DEFAULT_AI_SETTINGS = {
  provider: 'openrouter',
  model: 'z-ai/glm-5.3',
  enabled: true,
};

@Controller('v1/admin')
@UseGuards(PlatformAdminGuard)
export class PlatformAdminController {
  constructor(private prisma: PrismaService) {}

  /** GET /admin/tenants — cross-tenant listing (allowed only here, ADR-0001). */
  @Get('tenants')
  async listTenants(@Query('q') q?: string) {
    const tenants = await this.prisma.tenant.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q } }] } : {},
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true, conversations: true } } },
    });
    return {
      data: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        suspended: t.suspended,
        locale: t.locale,
        createdAt: t.createdAt,
        users: t._count.users,
        conversations: t._count.conversations,
      })),
    };
  }

  @Patch('tenants/:id')
  async patchTenant(@Param('id') id: string, @Body() body: unknown) {
    const data = patchTenantSchema.parse(body);
    const tenant = await this.prisma.tenant.update({ where: { id }, data });
    return { data: { id: tenant.id, name: tenant.name, plan: tenant.plan, suspended: tenant.suspended } };
  }

  /** GET /admin/users — cross-tenant, read-only in MVP (API contract). */
  @Get('users')
  async listUsers(@Query('tenantId') tenantId?: string, @Query('q') q?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(q ? { email: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { tenant: { select: { name: true, slug: true } } },
    });
    return {
      data: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        locale: u.locale,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt,
        tenant: u.tenant,
      })),
    };
  }

  @Get('settings')
  async getSettings() {
    const row = await this.prisma.globalSetting.findUnique({ where: { key: 'ai' } });
    return { data: (row?.value as object) ?? DEFAULT_AI_SETTINGS };
  }

  @Put('settings')
  async putSettings(@Body() body: unknown) {
    const value = putSettingsSchema.parse(body);
    const row = await this.prisma.globalSetting.upsert({
      where: { key: 'ai' },
      update: { value: value as object },
      create: { key: 'ai', value: value as object },
    });
    return { data: row.value };
  }
}

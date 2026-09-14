import { Controller, Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { TenantRoleGuard, MinRole } from '../auth/guards';

const patchAiSchema = z
  .object({
    model: z.string().min(1).max(120),
  })
  .strict();

/**
 * Tenant AI settings for the workspace (prototype-at-root). The OpenRouter key
 * is operator-managed via env (OPENROUTER_API_KEY) — tenants configure only
 * the model; reads are agent-visible, writes require admin.
 */
@Controller('v1/settings')
@UseGuards(TenantRoleGuard)
export class SettingsController {
  constructor(private prisma: PrismaService) {}

  private async current(tenantId: string) {
    const [tenantSetting, globalAi] = await Promise.all([
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
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      model: tenantSetting?.aiModel || globalModel || 'z-ai/glm-5.3',
      version: tenantSetting?.aiModelUpdatedAt?.getTime() ?? 0,
    };
  }

  @Get('ai')
  @MinRole('agent')
  async getAi(@Req() req: Request) {
    return { data: await this.current(req.user!.tenantId) };
  }

  @Patch('ai')
  @MinRole('admin')
  async patchAi(@Req() req: Request, @Body() body: unknown) {
    const data = patchAiSchema.parse(body);
    const now = new Date();
    await this.prisma.tenantSetting.upsert({
      where: { tenantId: req.user!.tenantId },
      create: { tenantId: req.user!.tenantId, aiModel: data.model, aiModelUpdatedAt: now },
      update: { aiModel: data.model, aiModelUpdatedAt: now },
    });
    return { data: await this.current(req.user!.tenantId) };
  }
}

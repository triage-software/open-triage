import {
  Controller, Get, Post, Patch, Delete, Body, Param, Req,
  UseGuards, NotFoundException, ConflictException, ForbiddenException, ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma.service';
import { TenantRoleGuard, MinRole } from '../auth/guards';
import { generateToken } from '../auth/crypto.util';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'agent']).default('agent'),
  locale: z.enum(['en', 'pl']).default('en'),
  name: z.string().max(120).optional(),
});

const patchUserSchema = z.object({
  role: z.enum(['owner', 'admin', 'agent']).optional(),
  locale: z.enum(['en', 'pl']).optional(),
  name: z.string().max(120).nullable().optional(),
});

const TEMP_PASSWORD_BYTES = 12;

@Controller('v1/users')
@UseGuards(TenantRoleGuard)
@MinRole('admin')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: Request) {
    const users = await this.prisma.user.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, name: true, role: true, locale: true,
        emailVerified: true, createdAt: true, deactivatedAt: true,
      },
    });
    return { data: users };
  }

  /** POST /users — invite a teammate. Returns a one-time setup token (MVP: shown in UI). */
  @Post()
  async invite(@Req() req: Request, @Body() body: unknown) {
    const data = inviteSchema.parse(body);
    const tenantId = req.user!.tenantId;
    const exists = await this.prisma.user.findFirst({ where: { tenantId, email: data.email } });
    if (exists) throw new ConflictException({ code: 'EMAIL_TAKEN' });

    const setupToken = generateToken();
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: data.email,
        // invited user sets a real password on first login via setup token;
        // MVP stores a random unusable hash until then.
        passwordHash: await argon2.hash(generateToken(32), { type: argon2.argon2id }),
        role: data.role,
        locale: data.locale,
        name: data.name ?? null,
        invited: true,
        verifyToken: setupToken,
      },
      select: { id: true, email: true, role: true, locale: true, createdAt: true },
    });
    console.info(`[users] invite setup token for ${data.email}: ${setupToken}`);
    return { data: user };
  }

  @Patch(':id')
  async patchUser(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const data = patchUserSchema.parse(body);
    const tenantId = req.user!.tenantId;
    const target = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND' });
    // Only owners may touch owners; admins may not escalate to owner
    if (data.role === 'owner' && req.user!.role !== 'owner') {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    if (target.role === 'owner' && req.user!.role !== 'owner') {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, role: true, locale: true, name: true },
    });
    return { data: updated };
  }

  @Delete(':id')
  async deactivate(@Req() req: Request, @Param('id') id: string) {
    const tenantId = req.user!.tenantId;
    const target = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (target.role === 'owner') throw new ForbiddenException({ code: 'OWNER_UNDELETABLE' });
    if (target.id === req.user!.userId) throw new ForbiddenException({ code: 'SELF_DELETE' });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { deactivatedAt: new Date() } }),
      this.prisma.session.deleteMany({ where: { userId: id } }),
    ]);
    return { data: { ok: true } };
  }
}

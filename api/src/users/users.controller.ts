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
import { Producer } from '../worker/producer';
import { PRODUCER } from '../worker/producer.module';
import { Inject } from '@nestjs/common';

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

// PATCH /users/me — self-service only: name/locale. Role is deliberately
// absent so no caller (including an admin patching their own record) can
// escalate or change roles through the self-service endpoint.
const patchMeSchema = z
  .object({
    name: z.string().max(120).nullable().optional(),
    locale: z.enum(['en', 'pl']).optional(),
  })
  .strict();

const TEMP_PASSWORD_BYTES = 12;

@Controller('v1/users')
@UseGuards(TenantRoleGuard)
@MinRole('admin')
export class UsersController {
  constructor(
    private prisma: PrismaService,
    @Inject(PRODUCER) private producer: Producer,
  ) {}

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

  /** POST /users — invite a teammate. Queues the invite e-mail when SMTP is
   *  configured; otherwise keeps the MVP contract (setupToken in the response
   *  for the inviting admin to hand over). */
  @Post()
  async invite(@Req() req: Request, @Body() body: unknown) {
    const data = inviteSchema.parse(body);
    const tenantId = req.user!.tenantId;
    const exists = await this.prisma.user.findFirst({ where: { tenantId, email: data.email } });
    if (exists) throw new ConflictException({ code: 'EMAIL_TAKEN' });

    const setupToken = generateToken();
    const [user, tenant] = await Promise.all([
      this.prisma.user.create({
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
      }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      }),
    ]);

    const payload = {
      tenantId,
      email: data.email,
      token: setupToken,
      locale: data.locale,
      inviterName: req.user!.email,
      tenantName: tenant?.name ?? 'Open Triage',
    };
    const queued = await this.producer.enqueueInviteMail(payload);
    if (queued) {
      // SMTP delivery queued — the token no longer travels in the response.
      return { data: user };
    }
    // MVP fallback (no SMTP): the inviting admin hands over the setup link.
    console.info(`[users] invite setup token for ${data.email}: ${setupToken}`);
    return { data: { ...user, setupToken } };
  }

  @Patch('me')
  @MinRole('agent')
  async patchMe(@Req() req: Request, @Body() body: unknown) {
    // Self-service profile (any role): the tenant user may change only their
    // own name/locale, scoped to req.user.userId — role is NOT editable here.
    // Declared before @Patch(':id') so Express resolves /users/me to this
    // handler instead of the id-patched one.
    const data = patchMeSchema.parse(body);
    const updated = await this.prisma.user.update({
      where: { id: req.user!.userId },
      data,
      select: { id: true, email: true, name: true, role: true, locale: true },
    });
    return { data: updated };
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

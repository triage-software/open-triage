import {
  Body,
  Controller,
  Delete,
  BadRequestException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MinRole, TenantRoleGuard } from '../auth/guards';
import { encryptSecret, decryptSecret } from '../auth/crypto.util';
import { MailboxVerifyService, MailboxVerifyExceptionFilter } from './mailbox-verify.service';

/**
 * Mailboxes module (API-CONTRACT-OUTLINE, Mailboxes section — admin of tenant).
 * ADR-0001: every query is tenant-scoped via req.user.tenantId. Credentials are
 * encrypted at rest with a SESSION_SECRET-derived key and never returned —
 * list/create/update all go through serializeMailbox().
 */

const createMailboxSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['imap', 'channel']).default('imap'),
  host: z.string().min(1).max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().default(true),
  user: z.string().min(1).max(320).optional(),
  password: z.string().max(1024).optional(),
  sentFolder: z.string().min(1).max(255).optional(),
  active: z.boolean().default(true),
});

const updateMailboxSchema = createMailboxSchema.partial().extend({
  /** `password: null` clears stored credentials. */
  password: z.string().max(1024).nullable().optional(),
});

const verifyMailboxSchema = z
  .object({
    /** Optional SMTP reachability probe for this verify call (not persisted). */
    smtpHost: z.string().min(1).max(253).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
  })
  .partial();

/** The only mailbox shape that ever leaves the API — no password material. */
export function serializeMailbox(box: {
  id: string;
  kind: string;
  name: string;
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  sentFolder: string | null;
  active: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: box.id,
    kind: box.kind,
    name: box.name,
    host: box.host,
    port: box.port,
    secure: box.secure,
    user: box.user,
    sentFolder: box.sentFolder,
    active: box.active,
    lastSyncAt: box.lastSyncAt,
    createdAt: box.createdAt,
  };
}

/** Enforces the imap-kind connection contract at the boundary (Zod can't). */
export function validateConnectionFields(
  data: { kind: 'imap' | 'channel'; host?: string | null; user?: string | null },
  partial: boolean,
): void {
  if (data.kind === 'channel') return;
  if (partial) {
    // Update: absent keys mean "keep the stored value" — only reject when the
    // client explicitly sends an empty host/user for an imap mailbox.
    const hostEmpty = 'host' in data && (data.host === null || data.host === '');
    const userEmpty = 'user' in data && (data.user === null || data.user === '');
    if (hostEmpty || userEmpty) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'imap mailboxes require non-empty host and user',
      });
    }
    return;
  }
  // Create: imap mailboxes need both.
  if (!data.host) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'host: required for imap mailboxes' });
  }
  if (!data.user) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'user: required for imap mailboxes' });
  }
}

@Controller('v1/mailboxes')
@UseGuards(TenantRoleGuard)
@MinRole('admin')
@UseFilters(MailboxVerifyExceptionFilter)
export class MailboxesController {
  constructor(
    private prisma: PrismaService,
    private verifier: MailboxVerifyService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const mailboxes = await this.prisma.mailbox.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return { data: mailboxes.map(serializeMailbox) };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: unknown) {
    const data = createMailboxSchema.parse(body);
    validateConnectionFields(data, false);
    const mailbox = await this.prisma.mailbox.create({
      data: {
        tenantId: req.user!.tenantId,
        kind: data.kind,
        name: data.name,
        host: data.host ?? null,
        port: data.port ?? null,
        secure: data.secure,
        user: data.user ?? null,
        passwordEnc:
          data.password !== undefined ? encryptSecret(data.password, process.env.SESSION_SECRET ?? '') : null,
        sentFolder: data.sentFolder ?? null,
        active: data.active,
      },
    });
    return { data: serializeMailbox(mailbox) };
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const data = updateMailboxSchema.parse(body);
    validateConnectionFields({ ...data, kind: data.kind ?? 'imap' }, true);
    const tenantId = req.user!.tenantId;
    const existing = await this.prisma.mailbox.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });

    const patch: Prisma.MailboxUpdateInput = {};
    if (data.kind !== undefined) patch.kind = data.kind;
    if (data.name !== undefined) patch.name = data.name;
    if (data.host !== undefined) patch.host = data.host;
    if (data.port !== undefined) patch.port = data.port;
    if (data.secure !== undefined) patch.secure = data.secure;
    if (data.user !== undefined) patch.user = data.user;
    if (data.sentFolder !== undefined) patch.sentFolder = data.sentFolder;
    if (data.active !== undefined) patch.active = data.active;
    if (data.password !== undefined) {
      patch.passwordEnc =
        data.password === null ? null : encryptSecret(data.password, process.env.SESSION_SECRET ?? '');
    }

    const mailbox = await this.prisma.mailbox.update({ where: { id }, data: patch });
    return { data: serializeMailbox(mailbox) };
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const tenantId = req.user!.tenantId;
    const existing = await this.prisma.mailbox.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    try {
      await this.prisma.mailbox.delete({ where: { id } });
    } catch (err) {
      // FK from conversations.mailboxId is restrict-on-delete; expose as 400.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BadRequestException({ code: 'MAILBOX_IN_USE', message: 'mailbox still has conversations' });
      }
      throw err;
    }
    return { data: { ok: true } };
  }

  /** POST /mailboxes/:id/verify → dry-run IMAP (and optional SMTP) connect+auth. */
  @Post(':id/verify')
  @HttpCode(200)
  async verifyMailbox(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const opts = verifyMailboxSchema.parse(body ?? {});
    const tenantId = req.user!.tenantId;
    const box = await this.prisma.mailbox.findFirst({ where: { id, tenantId } });
    if (!box) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (box.kind !== 'imap' || !box.host || !box.user) {
      throw new BadRequestException({
        code: 'VERIFY_NOT_APPLICABLE',
        message: 'mailbox has no IMAP connection settings',
      });
    }
    const password = box.passwordEnc ? decryptSecret(box.passwordEnc, process.env.SESSION_SECRET ?? '') : null;
    if (!password) {
      throw new BadRequestException({ code: 'NO_CREDENTIALS', message: 'mailbox has no stored password' });
    }

    const target = { host: box.host, port: box.port ?? 993, secure: box.secure, user: box.user, password };
    const result = await this.verifier.verifyImap(target);
    if (opts.smtpHost) {
      await this.verifier.verifySmtp({
        host: opts.smtpHost,
        port: opts.smtpPort ?? 465,
        secure: opts.smtpSecure ?? true,
        user: target.user,
        password,
      });
    }
    return { data: { ok: result.ok } };
  }
}

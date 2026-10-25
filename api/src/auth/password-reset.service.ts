import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { Producer } from '../worker/producer';
import { PRODUCER } from '../worker/producer.module';

const requestSchema = z.object({ email: z.string().trim().email().max(254) });
const resetSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().min(10).max(200) });
const TTL_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const eligibleUser = { deactivatedAt: null, invited: false, tenant: { suspended: false } } as const;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  constructor(private prisma: PrismaService, @Inject(PRODUCER) private producer: Producer) {}

  async requestReset(input: unknown) {
    const { email } = requestSchema.parse(input);
    // Check global configuration before looking up the address: an outage must
    // not disclose whether an account exists. Tokens never go into the response.
    if (!this.producer.passwordResetDeliveryEnabled) {
      throw new ServiceUnavailableException({ code: 'RESET_UNAVAILABLE' });
    }
    // Prisma's PostgreSQL case-insensitive equality uses ILIKE. Escape its
    // pattern characters so an address selects only that literal mailbox.
    const literalEmail = email.replace(/[\\%_]/g, '\\$&');
    const [users, admins] = await Promise.all([
      this.prisma.user.findMany({ where: { email: { equals: literalEmail, mode: 'insensitive' }, ...eligibleUser }, include: { tenant: true } }),
      this.prisma.platformAdmin.findMany({ where: { email: { equals: literalEmail, mode: 'insensitive' } } }),
    ]);
    const accounts = [
      ...users.map((user) => ({ ...user, kind: 'user' as const, accountName: user.tenant.name })),
      ...admins.map((admin) => ({ ...admin, kind: 'admin' as const, accountName: admin.locale === 'pl' ? 'Administracja platformy' : 'Platform administration' })),
    ];
    for (const account of accounts) {
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      const hash = tokenHash(token);
      const where = {
        id: account.id,
        OR: [{ passwordResetRequestedAt: null }, { passwordResetRequestedAt: { lte: new Date(now.getTime() - COOLDOWN_MS) } }],
      };
      const data = { passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(now.getTime() + TTL_MS), passwordResetRequestedAt: now };
      const issued = account.kind === 'user'
        ? await this.prisma.user.updateMany({ where: { ...where, ...eligibleUser }, data })
        : await this.prisma.platformAdmin.updateMany({ where, data });
      if (issued.count !== 1) continue;
      const queued = await this.producer.enqueuePasswordResetMail({ email: account.email, locale: account.locale, accountName: account.accountName, token });
      if (!queued) {
        // Allow a later retry, without clearing a newer concurrent request.
        const failed = { id: account.id, passwordResetTokenHash: hash };
        const clear = { passwordResetTokenHash: null, passwordResetExpiresAt: null, passwordResetRequestedAt: null };
        if (account.kind === 'user') await this.prisma.user.updateMany({ where: failed, data: clear });
        else await this.prisma.platformAdmin.updateMany({ where: failed, data: clear });
        this.logger.warn('Password reset mail could not be queued');
      }
    }
    return { ok: true };
  }

  async resetPassword(input: unknown) {
    const parsed = resetSchema.safeParse(input);
    if (!parsed.success) {
      // Malformed links and expired/used links share the same recovery path.
      if (parsed.error.issues.some((issue) => issue.path[0] === 'token')) this.invalidToken();
      throw parsed.error;
    }
    const { token, password } = parsed.data;
    const hash = tokenHash(token);
    const [user, admin] = await Promise.all([
      this.prisma.user.findUnique({ where: { passwordResetTokenHash: hash } }),
      this.prisma.platformAdmin.findUnique({ where: { passwordResetTokenHash: hash } }),
    ]);
    const account = user ?? admin;
    if (!account?.passwordResetExpiresAt || account.passwordResetExpiresAt <= new Date()) this.invalidToken();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      const where = { id: account.id, passwordResetTokenHash: hash, passwordResetExpiresAt: { gt: new Date() } };
      const data = { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null };
      // Conditional UPDATE locks this account. Exactly one concurrent consumer
      // succeeds; clearing the token and revoking sessions commit together.
      const changed = user
        ? await tx.user.updateMany({ where: { ...where, ...eligibleUser }, data })
        : await tx.platformAdmin.updateMany({ where, data });
      if (changed.count !== 1) this.invalidToken();
      await tx.session.deleteMany({ where: user ? { userId: account.id } : { adminId: account.id } });
    });
    return { ok: true };
  }

  private invalidToken(): never {
    throw new BadRequestException({ code: 'INVALID_RESET_TOKEN' });
  }
}

import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { generateSessionId, generateToken, slugify, signSessionId } from './crypto.util';

export const signupSchema = z.object({
  tenantName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(10).max(200),
  locale: z.enum(['en', 'pl']).default('en'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  /** POST /auth/signup — creates tenant + owner user (SPEC-0001, API contract). */
  async signup(input: unknown, res: { cookie: (n: string, v: string, o: object) => void }) {
    const data = signupSchema.parse(input);
    const existingUser = await this.prisma.user.findFirst({ where: { email: data.email } });
    if (existingUser) throw new ConflictException({ code: 'EMAIL_TAKEN' });

    let slug = slugify(data.tenantName);
    if (await this.prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${slug}-${generateToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }

    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id });
    const verifyToken = generateToken();

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        role: 'owner',
        locale: data.locale,
        emailVerified: false,
        verifyToken,
        tenant: {
          create: { name: data.tenantName, slug, locale: data.locale },
        },
      },
      include: { tenant: true },
    });

    // ADR-0002: e-mail verification token issued; delivery via SMTP is wired
    // in the worker module — MVP logs it server-side for self-host operators.
    console.info(`[auth] verification token for ${data.email}: ${verifyToken}`);

    await this.createSessionForUser(user.id, res);
    return {
      user: { id: user.id, email: user.email, role: user.role, locale: user.locale },
      tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
    };
  }

  /** POST /auth/login */
  async login(input: unknown, res: { cookie: (n: string, v: string, o: object) => void }) {
    const data = loginSchema.parse(input);

    // Platform admins authenticate the same way (ADR-0002)
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: data.email } });
    if (admin && (await argon2.verify(admin.passwordHash, data.password))) {
      await this.createSessionForAdmin(admin.id, res);
      return { platformAdmin: true, email: admin.email, locale: admin.locale };
    }

    const user = await this.prisma.user.findFirst({
      where: { email: data.email },
      include: { tenant: true },
    });
    if (!user || user.deactivatedAt || !(await argon2.verify(user.passwordHash, data.password))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    if (user.tenant.suspended) throw new UnauthorizedException({ code: 'TENANT_SUSPENDED' });
    await this.createSessionForUser(user.id, res);
    return {
      user: { id: user.id, email: user.email, role: user.role, locale: user.locale },
      tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
    };
  }

  /** POST /auth/logout — deletes the session row (instant revocation, ADR-0002). */
  async logout(sessionId: string | undefined) {
    if (sessionId) {
      await this.prisma.session.deleteMany({ where: { id: sessionId } });
    }
    return { ok: true };
  }

  /** GET /auth/me */
  async me(user: {
    userId: string; tenantId: string; role: string; email: string; locale: string;
  }) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: { tenant: true },
    });
    if (!u) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    return {
      user: { id: u.id, email: u.email, role: u.role, locale: u.locale, name: u.name, emailVerified: u.emailVerified },
      tenant: { id: u.tenant.id, name: u.tenant.name, slug: u.tenant.slug, plan: u.tenant.plan, locale: u.tenant.locale },
    };
  }

  /** POST /auth/verify {token} */
  async verify(token: string) {
    const user = await this.prisma.user.findUnique({ where: { verifyToken: token } });
    if (!user) throw new BadRequestException({ code: 'INVALID_TOKEN' });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verifyToken: null },
    });
    return { ok: true };
  }

  private async createSessionForUser(
    userId: string,
    res: { cookie: (n: string, v: string, o: object) => void },
  ) {
    const sessionId = generateSessionId();
    await this.prisma.session.create({
      data: { id: sessionId, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    this.setCookie(res, sessionId);
  }

  private async createSessionForAdmin(
    adminId: string,
    res: { cookie: (n: string, v: string, o: object) => void },
  ) {
    const sessionId = generateSessionId();
    await this.prisma.session.create({
      data: { id: sessionId, adminId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    this.setCookie(res, sessionId);
  }

  private setCookie(res: { cookie: (n: string, v: string, o: object) => void }, sessionId: string) {
    const secret = process.env.SESSION_SECRET ?? '';
    res.cookie('ot_session', signSessionId(sessionId, secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }
}

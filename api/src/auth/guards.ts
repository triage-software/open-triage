import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma.service';
import { parseSessionCookie, generateSessionId, signSessionId } from './crypto.util';
import { SESSION_COOKIE, RequestUser, RequestAdmin } from './auth.types';

export function setSessionCookie(res: Response, sessionId: string, secret: string, maxAgeSec = 60 * 60 * 24 * 30) {
  res.cookie(SESSION_COOKIE, signSessionId(sessionId, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeSec * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, secret: string) {
  // ADR-0002: cookie cleared by signing an already-invalid id; simplest is delete
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolves the session row from the request cookie, or null. */
export async function resolveSession(
  req: Request,
  prisma: PrismaService,
  secret: string,
): Promise<{ user: RequestUser | null; admin: RequestAdmin | null }> {
  const sessionId = parseSessionCookie(req.cookies?.[SESSION_COOKIE], secret);
  if (!sessionId) return { user: null, admin: null };

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { tenant: true } }, admin: true },
  });
  if (!session || session.expiresAt < new Date()) return { user: null, admin: null };

  if (session.user && !session.user.deactivatedAt && !session.user.tenant.suspended) {
    return {
      user: {
        userId: session.user.id,
        tenantId: session.user.tenantId,
        role: session.user.role,
        email: session.user.email,
        locale: session.user.locale,
        sessionId: session.id,
      },
      admin: null,
    };
  }
  if (session.admin) {
    return {
      user: null,
      admin: {
        adminId: session.admin.id,
        email: session.admin.email,
        locale: session.admin.locale,
        sessionId: session.id,
      },
    };
  }
  return { user: null, admin: null };
}

/** Any authenticated principal (tenant user or platform admin). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const { user, admin } = await resolveSession(req, this.prisma, process.env.SESSION_SECRET ?? '');
    if (!user && !admin) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    req.user = user ?? undefined;
    req.platformAdmin = admin ?? undefined;
    return true;
  }
}

const roleRank: Record<string, number> = { agent: 1, admin: 2, owner: 3 };

/** TenantRoleGuard: minRole 'admin' allows owner+admin; 'agent' allows all. */
@Injectable()
export class TenantRoleGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.platformAdmin) throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED' });
    if (!req.user) {
      // TenantRoleGuard resolves the session itself so controllers only need one guard.
      const { user, admin } = await resolveSession(req, this.prisma, process.env.SESSION_SECRET ?? '');
      if (admin) throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED' });
      if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
      req.user = user;
    }
    const min = this.getMinRole(ctx);
    if (roleRank[req.user.role] < roleRank[min]) {
      throw new ForbiddenException({ code: 'FORBIDDEN', details: { required: min, actual: req.user.role } });
    }
    return true;
  }

  private getMinRole(ctx: ExecutionContext): string {
    const handler = ctx.getHandler() as { minRole?: string };
    const cls = ctx.getClass() as { minRole?: string };
    return handler.minRole ?? cls.minRole ?? 'agent';
  }
}

/** Decorator helper to set required role on a handler/class. */
export function MinRole(role: 'agent' | 'admin' | 'owner'): MethodDecorator & ClassDecorator {
  return ((target: object, _key?: unknown, descriptor?: unknown) => {
    if (descriptor && typeof descriptor === 'object') {
      (descriptor as { minRole?: string }).minRole = role;
    } else {
      (target as { minRole?: string }).minRole = role;
    }
    return descriptor ?? target;
  }) as MethodDecorator & ClassDecorator;
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.platformAdmin) {
      const { user, admin } = await resolveSession(req, this.prisma, process.env.SESSION_SECRET ?? '');
      if (user || !admin) throw new ForbiddenException({ code: 'PLATFORM_ADMIN_REQUIRED' });
      req.platformAdmin = admin;
      req.user = undefined;
    }
    return true;
  }
}

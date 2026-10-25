/**
 * Session lifecycle through the real auth service, controller and guards.
 * Only persistence and HTTP request/response objects are in memory: password
 * verification, session IDs, cookie signing and revocation use production code.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { CookieOptions, Request, Response } from 'express';

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { SESSION_COOKIE } from '../src/auth/auth.types';
import { SessionGuard } from '../src/auth/guards';

const password = 'session-regression-password';
const secondPassword = 'second-tenant-regression-password';
let passwordHash: string;
let secondPasswordHash: string;

interface SessionRow {
  id: string;
  userId?: string;
  adminId?: string;
  expiresAt: Date;
}

function makeHarness() {
  const tenant = { id: 'tenant-1', name: 'Test tenant', slug: 'test-tenant', plan: 'free', locale: 'pl', suspended: false };
  const user = {
    id: 'user-1', tenantId: tenant.id, email: 'agent@example.test', passwordHash,
    name: 'Ada', role: 'agent', locale: 'pl', emailVerified: true,
    deactivatedAt: null as Date | null, tenant, createdAt: new Date('2026-01-01'),
  };
  const users = [user];
  const admin = { id: 'admin-1', email: 'admin@example.test', passwordHash, locale: 'en' };
  const sessions = new Map<string, SessionRow>();
  const database = {
    user: {
      findFirst: async ({ where }: { where: { email: string } }) => users.find((candidate) => candidate.email === where.email) ?? null,
      findMany: async ({ where, orderBy = [] }: {
        where: { email: string };
        orderBy?: Array<Partial<Record<'createdAt' | 'id', 'asc' | 'desc'>>>;
      }) => users.filter((candidate) => candidate.email === where.email).sort((left, right) => {
        for (const order of orderBy) {
          for (const field of ['createdAt', 'id'] as const) {
            const direction = order[field];
            if (!direction) continue;
            const difference = field === 'createdAt'
              ? left.createdAt.getTime() - right.createdAt.getTime()
              : left.id.localeCompare(right.id);
            if (difference) return direction === 'asc' ? difference : -difference;
          }
        }
        return 0;
      }),
      findUnique: async ({ where }: { where: { id: string } }) => users.find((candidate) => candidate.id === where.id) ?? null,
      updateMany: async ({ where, data }: {
        where: { id: string; passwordHash: string; deactivatedAt: null; tenant: { suspended: boolean } };
        data: { passwordHash: string };
      }) => {
        const user = users.find((candidate) => candidate.id === where.id
          && candidate.passwordHash === where.passwordHash
          && candidate.deactivatedAt === where.deactivatedAt
          && candidate.tenant.suspended === where.tenant.suspended);
        if (!user) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      },
    },
    platformAdmin: {
      findUnique: async ({ where }: { where: { email: string } }) => where.email === admin.email ? admin : null,
      updateMany: async ({ where, data }: {
        where: { id: string; passwordHash: string };
        data: { passwordHash: string };
      }) => {
        if (where.id !== admin.id || where.passwordHash !== admin.passwordHash) return { count: 0 };
        Object.assign(admin, data);
        return { count: 1 };
      },
    },
    session: {
      create: async ({ data }: { data: SessionRow }) => {
        sessions.set(data.id, { ...data });
        return data;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = sessions.get(where.id);
        return row ? {
          ...row,
          user: users.find((candidate) => candidate.id === row.userId) ?? null,
          admin: row.adminId === admin.id ? admin : null,
        } : null;
      },
      deleteMany: async ({ where }: { where: { id: string } }) => ({ count: sessions.delete(where.id) ? 1 : 0 }),
    },
  };
  const prisma = {
    ...database,
    async $transaction<T>(callback: (tx: typeof database) => Promise<T>): Promise<T> {
      return callback(database);
    },
  };
  const issuedCookies = new Map<string, { value: string; options: CookieOptions }>();
  const clearedCookies: string[] = [];
  const response = {
    cookie(name: string, value: string, options: CookieOptions) {
      issuedCookies.set(name, { value, options });
      return this;
    },
    clearCookie(name: string) {
      clearedCookies.push(name);
      return this;
    },
  } as unknown as Response;
  const service = new AuthService(prisma as never, {} as never);
  const controller = new AuthController(service);
  const guard = new SessionGuard(prisma as never);

  function cookie() {
    const value = issuedCookies.get(SESSION_COOKIE);
    assert.ok(value, 'successful login must issue a session cookie');
    return value;
  }

  function request(value?: string) {
    const req = {
      method: 'GET', url: '/v1/auth/me',
      cookies: value === undefined ? {} : { [SESSION_COOKIE]: value },
    } as unknown as Request;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => response }),
      getHandler: () => AuthController.prototype.me,
      getClass: () => AuthController,
    };
    return { req, authorize: () => guard.canActivate(ctx as never) };
  }

  async function login(email = user.email, suppliedPassword = password) {
    return controller.login({ email, password: suppliedPassword }, response);
  }

  function addMembership(hash = passwordHash) {
    const secondTenant = { ...tenant, id: 'tenant-2', name: 'Second tenant', slug: 'second-tenant' };
    const secondUser = {
      ...user, id: 'user-2', tenantId: secondTenant.id, tenant: secondTenant,
      passwordHash: hash, createdAt: new Date('2026-02-01'),
    };
    // Persistence order differs from the requested login order on purpose.
    users.unshift(secondUser);
    return secondUser;
  }

  return { user, tenant, admin, sessions, issuedCookies, clearedCookies, controller, response, request, login, cookie, addMembership };
}

async function rejectsUnauthorized(action: () => Promise<unknown>, code = 'UNAUTHENTICATED') {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException);
    assert.equal(error.getStatus(), 401);
    assert.deepEqual(error.getResponse(), { code });
    return true;
  });
}

describe('authentication session lifecycle', { concurrency: false }, () => {
  const previousSecret = process.env.SESSION_SECRET;

  before(async () => {
    process.env.SESSION_SECRET = 'auth-session-regression-signing-key';
    [passwordHash, secondPasswordHash] = await Promise.all([
      argon2.hash(password, { type: argon2.argon2id }),
      argon2.hash(secondPassword, { type: argon2.argon2id }),
    ]);
  });

  after(() => {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  test('login cookie authorizes /me and logout immediately rejects reuse of that cookie', async () => {
    const h = makeHarness();
    const result = await h.login();
    assert.ok(result.user);
    assert.equal(result.user.id, h.user.id);
    const cookie = h.cookie();
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.sameSite, 'lax');
    assert.equal(cookie.options.path, '/');
    assert.equal(cookie.options.maxAge, 30 * 24 * 60 * 60 * 1000);

    const signedIn = h.request(cookie.value);
    assert.equal(await signedIn.authorize(), true);
    assert.equal(signedIn.req.user?.userId, h.user.id);
    assert.equal(signedIn.req.user?.tenantId, h.tenant.id);
    assert.equal(signedIn.req.platformAdmin, undefined);
    const me = await h.controller.me(signedIn.req);
    assert.ok('user' in me);
    assert.equal(me.user.email, h.user.email);
    assert.equal('passwordHash' in me.user, false);

    assert.deepEqual(await h.controller.logout(signedIn.req, h.response), { ok: true });
    assert.deepEqual(h.clearedCookies, [SESSION_COOKIE]);
    await rejectsUnauthorized(h.request(cookie.value).authorize);
  });

  test('wrong password issues no cookie and creates no usable session', async () => {
    const h = makeHarness();
    await rejectsUnauthorized(() => h.login(h.user.email, 'incorrect-password'), 'INVALID_CREDENTIALS');
    assert.equal(h.issuedCookies.size, 0);
    assert.equal(h.sessions.size, 0);
  });

  test('missing and tampered cookies cannot authenticate an otherwise valid session', async () => {
    const h = makeHarness();
    await h.login();
    const value = h.cookie().value;
    const signatureStart = value.lastIndexOf('.') + 1;
    const replacement = value[signatureStart] === 'A' ? 'B' : 'A';
    const tampered = value.slice(0, signatureStart) + replacement + value.slice(signatureStart + 1);
    await rejectsUnauthorized(h.request().authorize);
    await rejectsUnauthorized(h.request(tampered).authorize);
    assert.equal(await h.request(value).authorize(), true, 'rejecting a forged cookie must preserve the valid session');
  });

  test('an expired persisted session rejects its correctly signed cookie', async () => {
    const h = makeHarness();
    await h.login();
    const cookie = h.cookie().value;
    const beforeExpiry = h.request(cookie);
    await beforeExpiry.authorize();
    const row = h.sessions.get(beforeExpiry.req.user!.sessionId);
    assert.ok(row);
    row.expiresAt = new Date(Date.now() - 1000);
    await rejectsUnauthorized(h.request(cookie).authorize);
  });

  test('tenant suspension blocks both an existing session and a new login', async () => {
    const h = makeHarness();
    await h.login();
    const cookie = h.cookie().value;
    assert.equal(await h.request(cookie).authorize(), true);
    h.tenant.suspended = true;
    await rejectsUnauthorized(h.request(cookie).authorize);
    await rejectsUnauthorized(() => h.login(), 'TENANT_SUSPENDED');
    h.tenant.suspended = false;
    assert.equal(await h.request(cookie).authorize(), true);
  });

  test('account deactivation blocks both an existing session and a new login', async () => {
    const h = makeHarness();
    await h.login();
    const cookie = h.cookie().value;
    assert.equal(await h.request(cookie).authorize(), true);
    h.user.deactivatedAt = new Date();
    await rejectsUnauthorized(h.request(cookie).authorize);
    await rejectsUnauthorized(() => h.login(), 'INVALID_CREDENTIALS');
  });

  test('the same email can log in to a later tenant using that membership password', async () => {
    const h = makeHarness();
    const secondUser = h.addMembership(secondPasswordHash);
    const result = await h.login(h.user.email, secondPassword);
    assert.ok(result.user);
    assert.equal(result.user.id, secondUser.id);
    const signedIn = h.request(h.cookie().value);
    assert.equal(await signedIn.authorize(), true);
    assert.equal(signedIn.req.user?.tenantId, secondUser.tenantId);
  });

  for (const blocked of ['deactivated', 'suspended'] as const) {
    test(`an earlier ${blocked} membership does not hide an active membership with the same email`, async () => {
      const h = makeHarness();
      const secondUser = h.addMembership();
      if (blocked === 'deactivated') h.user.deactivatedAt = new Date();
      else h.tenant.suspended = true;
      const result = await h.login();
      assert.ok(result.user);
      assert.equal(result.user.id, secondUser.id);
      const signedIn = h.request(h.cookie().value);
      assert.equal(await signedIn.authorize(), true);
      assert.equal(signedIn.req.user?.tenantId, secondUser.tenantId);
    });
  }

  test('a password matching only a suspended membership remains TENANT_SUSPENDED', async () => {
    const h = makeHarness();
    h.addMembership(secondPasswordHash);
    h.tenant.suspended = true;
    await rejectsUnauthorized(() => h.login(), 'TENANT_SUSPENDED');
    assert.equal(h.issuedCookies.size, 0);
    assert.equal(h.sessions.size, 0);
  });

  test('matching passwords on active memberships keep the earlier membership as the landing tenant', async () => {
    const h = makeHarness();
    h.addMembership();
    const result = await h.login();
    assert.ok(result.user);
    assert.equal(result.user.id, h.user.id);
    const signedIn = h.request(h.cookie().value);
    assert.equal(await signedIn.authorize(), true);
    assert.equal(signedIn.req.user?.tenantId, h.user.tenantId);
  });

  test('equal membership creation times use the ID to choose a stable landing tenant', async () => {
    const h = makeHarness();
    const secondUser = h.addMembership();
    secondUser.createdAt = new Date(h.user.createdAt);
    const result = await h.login();
    assert.ok(result.user);
    assert.equal(result.user.id, h.user.id);
    const signedIn = h.request(h.cookie().value);
    assert.equal(await signedIn.authorize(), true);
    assert.equal(signedIn.req.user?.tenantId, h.user.tenantId);
  });

  test('platform admin gets its own principal and logout revokes its session', async () => {
    const h = makeHarness();
    const result = await h.login(h.admin.email);
    assert.deepEqual(result, { platformAdmin: true, email: h.admin.email, locale: h.admin.locale });
    const cookie = h.cookie().value;
    const signedIn = h.request(cookie);
    assert.equal(await signedIn.authorize(), true);
    assert.equal(signedIn.req.user, undefined);
    assert.equal(signedIn.req.platformAdmin?.adminId, h.admin.id);
    assert.deepEqual(await h.controller.me(signedIn.req), {
      platformAdmin: { email: h.admin.email, locale: h.admin.locale },
    });
    await h.controller.logout(signedIn.req, h.response);
    await rejectsUnauthorized(h.request(cookie).authorize);
  });
});

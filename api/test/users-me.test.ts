/**
 * Regression: PATCH /v1/users/me (self-service profile).
 *  - any tenant role (agent included) may patch own name/locale;
 *  - role is NOT patchable through /me (strict schema rejects it);
 *  - PATCH /users/:id stays tenant-scoped: another tenant's id → 404.
 * Harness follows api/test/guards.test.ts: real guard + controller over
 * stub prisma — no DB, no network.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { ZodError } from 'zod';
import type { Request, Response } from 'express';

import { TenantRoleGuard } from '../src/auth/guards';
import { UsersController } from '../src/users/users.controller';

function makeCtx(user: { userId: string; tenantId: string; role: string } | null) {
  const req = {
    method: 'PATCH',
    url: '/v1/users/me',
    user,
    platformAdmin: undefined,
    cookies: {},
  } as unknown as Request;
  const res = {
    status() {
      return this;
    },
    json(body: unknown) {
      return body;
    },
  } as unknown as Response;
  return {
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
      getResponse: <T>() => res as T,
    }),
    getHandler: () => UsersController.prototype.patchMe,
    getClass: () => UsersController,
  };
}

function makeGuard() {
  const stub = { findUnique: async () => null };
  return new TenantRoleGuard(stub as unknown as ConstructorParameters<typeof TenantRoleGuard>[0]);
}

/** prisma stub: records update calls; findFirst configurable per test. */
function makeController(opts: { findFirst?: (args: unknown) => Promise<unknown> } = {}) {
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const prisma = {
    user: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push(args);
        return { id: args.where.id, email: 'me@t1.test', name: args.data.name ?? null, role: 'agent', locale: args.data.locale ?? 'en' };
      },
      findFirst: opts.findFirst ?? (async () => null),
    },
  };
  const controller = new UsersController(prisma as never);
  return { controller, updates };
}

describe('PATCH /v1/users/me — self-service profile', () => {
  test('handler overrides class-level admin gate: any role (agent) passes', async () => {
    const handler = Object.getOwnPropertyDescriptor(UsersController.prototype, 'patchMe')
      ?.value as { minRole?: string } | undefined;
    assert.equal(handler?.minRole, 'agent', 'patchMe must carry method-level @MinRole(agent)');
    // MinRole's ClassDecorator branch sets the role on the class function itself
    assert.equal((UsersController as unknown as { minRole?: string }).minRole, 'admin', 'class gate stays admin');

    const guard = makeGuard();
    const { controller } = makeController();
    const ctx = makeCtx({ userId: 'u1', tenantId: 't1', role: 'agent' });
    assert.equal(await guard.canActivate(ctx as never), true);
    const res = await controller.patchMe(
      (ctx.switchToHttp().getRequest() as Request),
      { name: 'Ada', locale: 'pl' },
    );
    assert.equal((res as { data: { locale: string } }).data.locale, 'pl');
  });

  test('scopes to the session user only (req.user.userId)', async () => {
    const guard = makeGuard();
    const { controller, updates } = makeController();
    const ctx = makeCtx({ userId: 'u-self', tenantId: 't1', role: 'admin' });
    await guard.canActivate(ctx as never);
    await controller.patchMe(ctx.switchToHttp().getRequest() as Request, { name: 'Renamed' });
    assert.deepEqual(updates.map((u) => u.where.id), ['u-self']);
  });

  test('role cannot be patched through /me (strict schema → ZodError)', async () => {
    const { controller, updates } = makeController();
    const req = makeCtx({ userId: 'u1', tenantId: 't1', role: 'admin' }).switchToHttp().getRequest() as Request;
    await assert.rejects(
      () => controller.patchMe(req, { role: 'owner' }),
      (err: unknown) => err instanceof ZodError,
    );
    assert.equal(updates.length, 0, 'no write may happen when role is smuggled in');
  });

  test('PATCH /users/:id is tenant-scoped: cross-tenant id → 404 NOT_FOUND', async () => {
    const { controller } = makeController({ findFirst: async () => null });
    const req = makeCtx({ userId: 'u1', tenantId: 't1', role: 'admin' }).switchToHttp().getRequest() as Request;
    await assert.rejects(
      () => controller.patchUser(req, 'user-of-another-tenant', { name: 'x' }),
      (err: { getStatus?: () => number }) => {
        assert.equal(err.getStatus?.(), 404);
        return true;
      },
    );
  });
});

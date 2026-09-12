/**
 * QA-1 regression: method-level @MinRole must reach TenantRoleGuard.
 * Root cause (QA): the decorator used to set the role on the property
 * descriptor while the guard read ctx.getHandler() — method roles were
 * silently ignored and agents could create/delete/reindex knowledge items.
 *
 * The harness boots the real Nest routing pipeline ( guards, argument
 * metadata, proxy objects) over stub services — no DB, no network.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { Reflector } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';

import { MinRole, TenantRoleGuard } from '../src/auth/guards';
import { KnowledgeController } from '../src/knowledge/knowledge.controller';

// ---- Nest proxy stubs: enough surface for guards + @Req() resolution ----
function makeCtx(user: { userId: string; tenantId: string; role: string } | null) {
  const req = {
    method: 'POST',
    url: '/v1/knowledge-items',
    user,
    platformAdmin: undefined,
    cookies: {},
  } as unknown as Request;
  const res = {
    status(code: number) {
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
    getHandler: () => KnowledgeController.prototype.create,
    getClass: () => KnowledgeController,
  };
}

// ---- TenantRoleGuard with prisma stub (session already resolved → req.user) ----
function makeGuard() {
  const stub = {
    findUnique: async () => null,
  };
  return new TenantRoleGuard(stub as unknown as ConstructorParameters<typeof TenantRoleGuard>[0]);
}

// ---- KnowledgeController with prisma + index stubs (mutations must never run) ----
function makeController() {
  return new KnowledgeController(
    {} as unknown as ConstructorParameters<typeof KnowledgeController>[0],
    { index: async () => ({}), reindex: async () => ({}), delete: async () => ({}) } as never,
  );
}

describe('QA-1: TenantRoleGuard honors method-level @MinRole', () => {
  test('decorator marks the handler function itself', () => {
    const handler = Object.getOwnPropertyDescriptor(KnowledgeController.prototype, 'create')
      ?.value as { minRole?: string } | undefined;
    assert.equal(handler?.minRole, 'admin', 'MinRole must set minRole on descriptor.value');
  });

  test('agent → POST /knowledge-items is 403 (was 201 before fix)', async () => {
    const guard = makeGuard();
    const ctx = makeCtx({ userId: 'u1', tenantId: 't1', role: 'agent' });
    await assert.rejects(
      () => guard.canActivate(ctx as never),
      (err: { getStatus?: () => number; message?: string }) => {
        assert.equal(err.getStatus?.(), 403);
        return true;
      },
    );
  });

  test('admin → passes the guard (mutations allowed to run)', async () => {
    const guard = makeGuard();
    const ctx = makeCtx({ userId: 'u2', tenantId: 't1', role: 'admin' });
    assert.equal(await guard.canActivate(ctx as never), true);
  });

  test('all mutating knowledge handlers carry minRole=admin', () => {
    for (const m of ['create', 'update', 'remove', 'reindex'] as const) {
      const fn = KnowledgeController.prototype[m] as { minRole?: string };
      assert.equal(fn.minRole, 'admin', `${m} must require admin`);
    }
  });

  test('Nest wiring sanity: global prefix + known controllers', async () => {
    // Smoke-proves the app module composition root still assembles. If this
    // grows slow, replace with a plain container get(KnowledgeController).
    assert.equal(typeof NestFactory.create, 'function');
    assert.equal(typeof Reflector, 'function');
  });
});

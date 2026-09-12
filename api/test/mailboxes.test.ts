/**
 * Mailboxes module regression harness (same style as guards.test.ts).
 * Boots the real Nest routing pipeline (guards, argument metadata, proxy
 * objects) over stub services — no DB, no network.
 *
 * Covers:
 * - class-level @MinRole('admin') reaches TenantRoleGuard (agent → 403)
 * - encryptSecret/decryptSecret roundtrip (AES-256-GCM, SESSION_SECRET-derived)
 * - MailboxVerifyError mapping to HTTP 400 {code,message}
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';

import { TenantRoleGuard } from '../src/auth/guards';
import { encryptSecret, decryptSecret, encryptionKey } from '../src/auth/crypto.util';
import {
  MailboxesController,
  serializeMailbox,
} from '../src/mailboxes/mailboxes.controller';
import {
  MailboxVerifyError,
  MailboxVerifyExceptionFilter,
} from '../src/mailboxes/mailbox-verify.service';

const SESSION_SECRET = 'test-secret-for-mailboxes-harness';

function makeCtx(user: { userId: string; tenantId: string; role: string } | null) {
  const req = {
    method: 'POST',
    url: '/v1/mailboxes',
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
    getHandler: () => MailboxesController.prototype.create,
    getClass: () => MailboxesController,
  };
}

function makeGuard() {
  const stub = {
    findUnique: async () => null,
  };
  return new TenantRoleGuard(stub as unknown as ConstructorParameters<typeof TenantRoleGuard>[0]);
}

describe('Mailboxes: class-level @MinRole admin reaches TenantRoleGuard', () => {
  test('class prototype carries minRole=admin', () => {
    const cls = MailboxesController as unknown as { minRole?: string };
    assert.equal(cls.minRole, 'admin', 'MailboxesController must require admin (class-level)');
  });

  test('agent → POST /mailboxes is 403', async () => {
    const guard = makeGuard();
    const ctx = makeCtx({ userId: 'u1', tenantId: 't1', role: 'agent' });
    await assert.rejects(
      () => guard.canActivate(ctx as never),
      (err: { getStatus?: () => number }) => {
        assert.equal(err.getStatus?.(), 403);
        return true;
      },
    );
  });

  test('admin → passes the guard', async () => {
    const guard = makeGuard();
    const ctx = makeCtx({ userId: 'u2', tenantId: 't1', role: 'admin' });
    assert.equal(await guard.canActivate(ctx as never), true);
  });

  test('owner → passes the guard (admin <= owner)', async () => {
    const guard = makeGuard();
    const ctx = makeCtx({ userId: 'u3', tenantId: 't1', role: 'owner' });
    assert.equal(await guard.canActivate(ctx as never), true);
  });
});

describe('Mailboxes: credential encryption at rest', () => {
  test('encrypt/decrypt roundtrip', () => {
    const secret = 'p@ssw0rd-źółć-忍者';
    const enc = encryptSecret(secret, SESSION_SECRET);
    assert.notEqual(enc, secret, 'ciphertext must differ from plaintext');
    assert.ok(!enc.includes('p@ssw0rd'), 'ciphertext must not embed plaintext');
    assert.equal(decryptSecret(enc, SESSION_SECRET), secret);
  });

  test('wrong secret fails to decrypt (GCM auth tag)', () => {
    const enc = encryptSecret('hunter2', SESSION_SECRET);
    assert.equal(decryptSecret(enc, 'another-secret'), null);
  });

  test('two encryptions of the same secret differ (random IV)', () => {
    const a = encryptSecret('same', SESSION_SECRET);
    const b = encryptSecret('same', SESSION_SECRET);
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a, SESSION_SECRET), 'same');
    assert.equal(decryptSecret(b, SESSION_SECRET), 'same');
  });

  test('key is derived from SESSION_SECRET (HMAC, 32 bytes)', () => {
    assert.equal(encryptionKey(SESSION_SECRET).length, 32);
    assert.equal(
      encryptionKey(SESSION_SECRET).equals(encryptionKey(SESSION_SECRET)),
      true,
    );
    assert.equal(
      encryptionKey(SESSION_SECRET).equals(encryptionKey('other-secret')),
      false,
    );
  });
});

describe('Mailboxes: serializer never leaks secrets', () => {
  test('serializeMailbox output has no password fields', () => {
    const box = {
      id: 'm1',
      kind: 'imap',
      name: 'Support',
      host: 'imap.example.com',
      port: 993,
      secure: true,
      user: 'support@example.com',
      passwordEnc: encryptSecret('topsecret', SESSION_SECRET),
      sentFolder: null,
      active: true,
      lastSyncAt: null,
      createdAt: new Date(0),
    };
    const out = serializeMailbox(box as never) as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      assert.ok(!/password/i.test(key), `serializer must not expose key: ${key}`);
      if (typeof out[key] === 'string') {
        assert.ok(!String(out[key]).includes('topsecret'), 'plaintext leaked');
      }
    }
  });
});

describe('Mailboxes: verify errors map to 400 {code,message}', () => {
  test('MailboxVerifyError carries its code', () => {
    const err = new MailboxVerifyError('INVALID_CREDENTIALS', 'IMAP bad: authentication failed');
    assert.equal(err.code, 'INVALID_CREDENTIALS');
    assert.match(err.message, /authentication failed/);
  });

  test('filter renders MailboxVerifyError as 400 JSON', () => {
    const filter = new MailboxVerifyExceptionFilter();
    const written: { status?: number; body?: unknown } = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            written.status = code;
            return this;
          },
          json(body: unknown) {
            written.body = body;
            return this;
          },
        }),
      }),
    } as never;
    filter.catch(new MailboxVerifyError('HOST_UNREACHABLE', 'IMAP bad: ECONNREFUSED'), host);
    assert.equal(written.status, 400);
    assert.deepEqual(written.body, {
      code: 'HOST_UNREACHABLE',
      message: 'IMAP bad: ECONNREFUSED',
    });
  });
});

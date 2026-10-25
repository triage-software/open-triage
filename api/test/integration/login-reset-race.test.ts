import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../src/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { PasswordResetService } from '../../src/auth/password-reset.service';
import { resolveSession } from '../../src/auth/guards';
import type { PasswordResetMailPayload } from '../../src/worker/producer';

const prisma = new PrismaService();
before(() => prisma.$connect());
after(() => prisma.$disconnect());

function barrier() {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { release = resolve; });
  return { reached, release };
}

for (const kind of ['user', 'admin'] as const) {
  test(`${kind}: an old-password login cannot create a session after reset commits`, { timeout: 15000 }, async () => {
    const email = `${randomUUID()}@example.test`;
    const oldPassword = randomUUID();
    const passwordHash = await argon2.hash(oldPassword, { type: argon2.argon2id });
    const account = kind === 'user'
      ? await prisma.user.create({ data: {
        email, passwordHash, role: 'owner',
        tenant: { create: { name: 'Login reset race', slug: randomUUID() } },
      } })
      : await prisma.platformAdmin.create({ data: { email, passwordHash } });
    const mails: PasswordResetMailPayload[] = [];
    const producer = {
      passwordResetDeliveryEnabled: true,
      enqueuePasswordResetMail: async (payload: PasswordResetMailPayload) => { mails.push(payload); return true; },
    };
    const reset = new PasswordResetService(prisma, producer as never);
    const auth = new AuthService(prisma, producer as never);
    let existingCookie = '';
    await auth.login({ email, password: oldPassword }, { cookie: (_name, value) => { existingCookie = value; } });
    await reset.requestReset({ email });
    assert.equal(mails.length, 1);

    const captured = barrier();
    const resume = barrier();
    // The real database lookup finishes before the barrier. Only its return is
    // delayed, so the login verifies an actual snapshot of the old credential.
    const pausedPrisma = prisma.$extends({ query: {
      user: {
        async findMany({ args, query }) {
          const users = await query(args);
          if (kind === 'user') { captured.release(); await resume.reached; }
          return users;
        },
      },
      platformAdmin: {
        async findUnique({ args, query }) {
          const admin = await query(args);
          if (kind === 'admin') { captured.release(); await resume.reached; }
          return admin;
        },
      },
    } });
    const delayedAuth = new AuthService(pausedPrisma as never, producer as never);
    const issuedCookies: string[] = [];
    const pendingLogin = delayedAuth.login({ email, password: oldPassword }, {
      cookie: (_name, value) => { issuedCookies.push(value); },
    });
    // Attach a handler before releasing the barrier to avoid unhandled rejects.
    const outcome = pendingLogin.then(
      (body) => ({ status: 'fulfilled' as const, body }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    const newPassword = randomUUID();
    try {
      await captured.reached;
      await reset.resetPassword({ token: mails[0].token, password: newPassword });
    } finally {
      resume.release();
    }

    const result = await outcome;
    assert.equal(result.status, 'rejected', 'a reset committed after lookup must invalidate this login attempt');
    if (result.status !== 'rejected') assert.fail('old-password login unexpectedly succeeded');
    assert.equal((result.error as { getStatus(): number }).getStatus(), 401);
    assert.deepEqual((result.error as { getResponse(): unknown }).getResponse(), { code: 'INVALID_CREDENTIALS' });
    assert.deepEqual(issuedCookies, [], 'no session cookie may escape a rejected transaction');
    const sessionWhere = kind === 'user' ? { userId: account.id } : { adminId: account.id };
    assert.equal(await prisma.session.count({ where: sessionWhere }), 0);
    assert.deepEqual(await resolveSession({ cookies: { ot_session: existingCookie } } as never, prisma, process.env.SESSION_SECRET!), { user: null, admin: null });

    let newCookie = '';
    await auth.login({ email, password: newPassword }, { cookie: (_name, value) => { newCookie = value; } });
    const principal = await resolveSession({ cookies: { ot_session: newCookie } } as never, prisma, process.env.SESSION_SECRET!);
    if (kind === 'user') assert.equal(principal.user?.userId, account.id);
    else assert.equal(principal.admin?.adminId, account.id);
  });
}

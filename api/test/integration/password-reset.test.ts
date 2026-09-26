import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../src/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { resolveSession } from '../../src/auth/guards';
import type { PasswordResetMailPayload } from '../../src/worker/producer';

const prisma = new PrismaService();
before(() => prisma.$connect());
after(() => prisma.$disconnect());

async function fixture() {
  const password = randomUUID();
  const tenant = await prisma.tenant.create({ data: { name: `Recovery ${randomUUID()}`, slug: randomUUID() } });
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${randomUUID()}@example.test`,
    passwordHash: await argon2.hash(password), role: 'owner',
  } });
  const mails: PasswordResetMailPayload[] = [];
  const producer = {
    passwordResetDeliveryEnabled: true,
    enqueuePasswordResetMail: async (payload: PasswordResetMailPayload) => { mails.push(payload); return true; },
  };
  const { PasswordResetService } = await import('../../src/auth/password-reset.service');
  const service = new PasswordResetService(prisma, producer as never);
  const auth = new AuthService(prisma, producer as never);
  async function login(suppliedPassword = password) {
    let cookie = '';
    const body = await auth.login({ email: user.email, password: suppliedPassword }, { cookie: (_n, value) => { cookie = value; } });
    return { body, cookie };
  }
  return { tenant, user, password, mails, producer, service, auth, login };
}

test('a mailed reset link changes the password once and revokes existing sessions', async () => {
  const f = await fixture();
  const oldSession = await f.login();
  assert.deepEqual(await f.service.requestReset({ email: f.user.email }), { ok: true });
  assert.equal(f.mails.length, 1);
  assert.equal(f.mails[0].email, f.user.email);
  assert.equal(f.mails[0].accountName, f.tenant.name);
  const newPassword = randomUUID();
  assert.deepEqual(await f.service.resetPassword({ token: f.mails[0].token, password: newPassword }), { ok: true });
  await assert.rejects(() => f.login(), { status: 401 });
  assert.ok((await f.login(newPassword)).cookie);
  assert.deepEqual(await resolveSession({ cookies: { ot_session: oldSession.cookie } } as never, prisma, process.env.SESSION_SECRET!), { user: null, admin: null });
  await assert.rejects(() => f.service.resetPassword({ token: f.mails[0].token, password: randomUUID() }), { status: 400 });
});

test('only one concurrent use of a reset link commits a new password', async () => {
  const f = await fixture();
  await f.service.requestReset({ email: f.user.email });
  const passwords = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled(passwords.map((password) => f.service.resetPassword({ token: f.mails[0].token, password })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const winner = results.findIndex((result) => result.status === 'fulfilled');
  assert.ok((await f.login(passwords[winner])).cookie);
  await assert.rejects(() => f.login(passwords[1 - winner]), { status: 401 });
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.getResponse().code, 'INVALID_RESET_TOKEN');
});

test('expired, malformed and unknown links leave passwords and sessions intact', async () => {
  const f = await fixture();
  const session = await f.login();
  await f.service.requestReset({ email: f.user.email });
  await prisma.user.update({ where: { id: f.user.id }, data: { passwordResetExpiresAt: new Date(Date.now() - 1) } });
  for (const token of [f.mails[0].token, 'bad-link', 'A'.repeat(43)]) {
    await assert.rejects(() => f.service.resetPassword({ token, password: randomUUID() }), (error: any) => error.getResponse().code === 'INVALID_RESET_TOKEN');
  }
  assert.ok((await f.login()).cookie);
  assert.ok((await resolveSession({ cookies: { ot_session: session.cookie } } as never, prisma, process.env.SESSION_SECRET!)).user);
});

test('concurrent requests send one link, store only its hash, and do not disclose unknown accounts', async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.service.requestReset({ email: f.user.email })));
  for (const response of responses) assert.deepEqual(response, { ok: true });
  assert.equal(f.mails.length, 1);
  assert.deepEqual(await f.service.requestReset({ email: `${randomUUID()}@example.test` }), responses[0]);
  assert.equal(f.mails.length, 1);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
  assert.match(stored.passwordResetTokenHash!, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.passwordResetTokenHash, f.mails[0].token);
  assert.equal(stored.passwordResetExpiresAt!.getTime() - stored.passwordResetRequestedAt!.getTime(), 30 * 60 * 1000);
});

test('another workspace with the same email keeps its password, session and reset token', async () => {
  const first = await fixture();
  const second = await fixture();
  await prisma.user.update({ where: { id: second.user.id }, data: { email: first.user.email } });
  const otherSession = await first.auth.login({ email: first.user.email, password: second.password }, { cookie() {} });
  assert.equal(otherSession.user?.id, second.user.id);
  await first.service.requestReset({ email: first.user.email });
  assert.equal(first.mails.length, 2);
  const token = first.mails.find((mail) => mail.accountName === first.tenant.name)!.token;
  const newPassword = randomUUID();
  await first.service.resetPassword({ token, password: newPassword });
  const secondLogin = await first.auth.login({ email: first.user.email, password: second.password }, { cookie() {} });
  assert.equal(secondLogin.user?.id, second.user.id);
  assert.equal(await prisma.session.count({ where: { userId: second.user.id } }), 2);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: second.user.id } })).passwordResetTokenHash);
});

for (const blocked of ['deactivated', 'suspended', 'invited'] as const) {
  test(`${blocked} accounts cannot request or consume a password reset`, async () => {
    const f = await fixture();
    await f.service.requestReset({ email: f.user.email });
    if (blocked === 'suspended') await prisma.tenant.update({ where: { id: f.tenant.id }, data: { suspended: true } });
    else await prisma.user.update({ where: { id: f.user.id }, data: blocked === 'deactivated' ? { deactivatedAt: new Date() } : { invited: true } });
    assert.deepEqual(await f.service.requestReset({ email: f.user.email }), { ok: true });
    assert.equal(f.mails.length, 1);
    await assert.rejects(() => f.service.resetPassword({ token: f.mails[0].token, password: randomUUID() }), { status: 400 });
    assert.ok(await argon2.verify((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).passwordHash, f.password));
  });
}

test('platform administrators can reset their password and revoke admin sessions', async () => {
  const f = await fixture();
  const email = `${randomUUID()}@example.test`;
  await prisma.platformAdmin.create({ data: { email, passwordHash: await argon2.hash(f.password), locale: 'pl' } });
  let cookie = '';
  await f.auth.login({ email, password: f.password }, { cookie: (_name, value) => { cookie = value; } });
  await f.service.requestReset({ email });
  assert.equal(f.mails[0].accountName, 'Administracja platformy');
  const nextPassword = randomUUID();
  await f.service.resetPassword({ token: f.mails[0].token, password: nextPassword });
  assert.deepEqual(await resolveSession({ cookies: { ot_session: cookie } } as never, prisma, process.env.SESSION_SECRET!), { user: null, admin: null });
  await assert.rejects(() => f.auth.login({ email, password: f.password }, { cookie() {} }), { status: 401 });
  assert.equal((await f.auth.login({ email, password: nextPassword }, { cookie() {} })).platformAdmin, true);
});

test('missing mail configuration is unavailable for both known and unknown emails', async () => {
  const f = await fixture();
  f.producer.passwordResetDeliveryEnabled = false;
  for (const email of [f.user.email, `${randomUUID()}@example.test`]) {
    await assert.rejects(() => f.service.requestReset({ email }), (error: any) => error.getStatus() === 503 && error.getResponse().code === 'RESET_UNAVAILABLE');
  }
  assert.equal(f.mails.length, 0);
});

test('a failed enqueue invalidates that link and permits an immediate retry', async () => {
  const f = await fixture();
  const enqueue = f.producer.enqueuePasswordResetMail;
  f.producer.enqueuePasswordResetMail = async (payload) => { f.mails.push(payload); return false; };
  assert.deepEqual(await f.service.requestReset({ email: f.user.email }), { ok: true });
  await assert.rejects(() => f.service.resetPassword({ token: f.mails[0].token, password: randomUUID() }), { status: 400 });
  f.producer.enqueuePasswordResetMail = enqueue;
  await f.service.requestReset({ email: f.user.email });
  assert.equal(f.mails.length, 2);
  assert.notEqual(f.mails[0].token, f.mails[1].token);
  await f.service.resetPassword({ token: f.mails[1].token, password: randomUUID() });
});

test('password validation does not consume a valid link', async () => {
  const f = await fixture();
  await f.service.requestReset({ email: f.user.email });
  for (const password of ['short', 'a'.repeat(201)]) {
    await assert.rejects(() => f.service.resetPassword({ token: f.mails[0].token, password }), { name: 'ZodError' });
  }
  await f.service.resetPassword({ token: f.mails[0].token, password: randomUUID() });
});

test('email punctuation is matched literally instead of selecting another address', async () => {
  const first = await fixture();
  const second = await fixture();
  const prefix = randomUUID();
  const email = `${prefix}_x@example.test`;
  await prisma.user.update({ where: { id: first.user.id }, data: { email } });
  await prisma.user.update({ where: { id: second.user.id }, data: { email: `${prefix}ax@example.test` } });
  await first.service.requestReset({ email });
  assert.deepEqual(first.mails.map((mail) => mail.email), [email]);
});

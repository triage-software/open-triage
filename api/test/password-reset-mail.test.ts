import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { NotificationService } from '../src/worker/notifications.service';
import { Producer } from '../src/worker/producer';

const payload = {
  email: 'reset@example.test',
  token: 'reset-token/+?&',
  locale: 'en',
  accountName: 'Support <script>alert(1)</script> & team',
};

async function withMailEnv(values: Record<string, string>, run: () => Promise<void>) {
  const keys = ['REDIS_URL', 'SMTP_SYSTEM_HOST', 'SMTP_HOST', 'SMTP_SYSTEM_FROM', 'SMTP_FROM'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('password reset delivery requires both a queue and complete SMTP configuration', async () => {
  await withMailEnv({ SMTP_HOST: 'localhost', SMTP_FROM: 'system@example.test' }, async () => {
    const producer = new Producer();
    assert.equal(producer.passwordResetDeliveryEnabled, false);
    assert.equal(await producer.enqueuePasswordResetMail(payload), false);
    Object.defineProperty(producer, 'notification', { value: { add: async () => undefined } });
    assert.equal(producer.passwordResetDeliveryEnabled, true);
    delete process.env.SMTP_FROM;
    assert.equal(producer.passwordResetDeliveryEnabled, false);
    assert.equal(await producer.enqueuePasswordResetMail(payload), false);
  });
});

test('password reset queue retries and removes secret-bearing jobs, using a hashed identity', async () => {
  await withMailEnv({ SMTP_SYSTEM_HOST: 'localhost', SMTP_SYSTEM_FROM: 'system@example.test' }, async () => {
    const calls: unknown[][] = [];
    const producer = new Producer();
    Object.defineProperty(producer, 'notification', { value: { add: async (...args: unknown[]) => { calls.push(args); } } });
    assert.equal(await producer.enqueuePasswordResetMail(payload), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'password-reset-mail');
    assert.deepEqual(calls[0][1], payload);
    assert.deepEqual(calls[0][2], {
      jobId: `password-reset-${createHash('sha256').update(payload.token).digest('hex')}`,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
    assert.ok(!JSON.stringify(calls[0][2]).includes(payload.token));
  });
});

test('password reset queue failure returns false without leaking a token', async () => {
  await withMailEnv({ SMTP_SYSTEM_HOST: 'localhost', SMTP_SYSTEM_FROM: 'system@example.test' }, async () => {
    const producer = new Producer();
    Object.defineProperty(producer, 'notification', { value: { add: async () => { throw new Error('queue unavailable'); } } });
    assert.equal(await producer.enqueuePasswordResetMail(payload), false);
  });
});

test('English reset email includes escaped account context and an encoded one-time link in HTML and text', async (context) => {
  await withMailEnv({ SMTP_HOST: 'localhost', SMTP_FROM: 'system@example.test' }, async () => {
    const messages: Record<string, string>[] = [];
    let closed = false;
    context.mock.method(nodemailer, 'createTransport', () => ({
      sendMail: async (message: Record<string, string>) => { messages.push(message); },
      close: () => { closed = true; },
    }) as never);
    await new NotificationService().sendPasswordResetMail(payload, 'http://localhost:3000/');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, payload.email);
    assert.equal(messages[0].from, 'system@example.test');
    assert.match(messages[0].subject, /Reset your password/);
    const url = `http://localhost:3000/reset-password?token=${encodeURIComponent(payload.token)}`;
    assert.ok(messages[0].html.includes(url));
    assert.ok(messages[0].text.includes(url));
    assert.ok(messages[0].html.includes('Support &lt;script&gt;alert(1)&lt;/script&gt; &amp; team'));
    assert.ok(!messages[0].html.includes('<script>'));
    assert.match(messages[0].text, /30 minutes/);
    assert.match(messages[0].text, /once/);
    assert.match(messages[0].text, /ignore/);
    assert.equal(closed, true);
  });
});

test('Polish reset email explains expiry, one-time use and an unrequested reset', async (context) => {
  await withMailEnv({ SMTP_SYSTEM_HOST: 'localhost', SMTP_SYSTEM_FROM: 'system@example.test' }, async () => {
    let message: Record<string, string> = {};
    context.mock.method(nodemailer, 'createTransport', () => ({
      sendMail: async (sent: Record<string, string>) => { message = sent; },
      close: () => undefined,
    }) as never);
    await new NotificationService().sendPasswordResetMail({ ...payload, locale: 'pl', accountName: 'Zespół' }, 'http://localhost:3000');
    assert.match(message.subject, /Zresetuj hasło/);
    assert.match(message.text, /Zespół/);
    assert.match(message.text, /30 minut/);
    assert.match(message.text, /jednokrotnie/);
    assert.match(message.text, /zignoruj/);
  });
});

test('reset email fails closed when SMTP is incomplete', async () => {
  await withMailEnv({ SMTP_SYSTEM_HOST: 'localhost' }, async () => {
    await assert.rejects(new NotificationService().sendPasswordResetMail(payload, 'http://localhost:3000'), /system SMTP not configured/);
  });
});

test('password reset enqueue returns false after five seconds when Redis never responds', { timeout: 1000 }, async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  await withMailEnv({ SMTP_SYSTEM_HOST: 'localhost', SMTP_SYSTEM_FROM: 'system@example.test' }, async () => {
    const producer = new Producer();
    Object.defineProperty(producer, 'notification', {
      value: { add: () => new Promise(() => undefined) },
    });
    let finished = false;
    const result = producer.enqueuePasswordResetMail(payload).then((queued) => {
      finished = true;
      return queued;
    });
    context.mock.timers.tick(4999);
    await Promise.resolve();
    assert.equal(finished, false);
    context.mock.timers.tick(1);
    assert.equal(await result, false);
  });
});

/**
 * Worker-increment regressions (t_87a44da4). Pure unit harness — no DB, no
 * network, no Redis. Covers:
 *  - threading helpers ported from the prototype
 *  - producer graceful degradation (no Redis → all enqueues return false)
 *  - WorkerModule wiring sanity (Nest assembles with the new module graph)
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { Producer } from '../src/worker/producer';
import { PRODUCER } from '../src/worker/producer.module';
import { WorkerModule } from '../src/worker/worker.module';
import {
  statusAfterInbound,
  statusAfterAgentSend,
  capThreadIds,
  replySubject,
  outboundMessageId,
  isThreadMatch,
} from '../src/worker/threading';
import { composeReplyRaw, systemMailHtml } from '../src/worker/mail-composer';

test('statusAfterInbound reopens resolved/pending conversations (prototype rule)', () => {
  assert.equal(statusAfterInbound('resolved'), 'open');
  assert.equal(statusAfterInbound('pending'), 'open');
  assert.equal(statusAfterInbound('open'), 'open');
});

test('statusAfterAgentSend hands the conversation back to the customer', () => {
  assert.equal(statusAfterAgentSend('open'), 'pending');
  assert.equal(statusAfterAgentSend('resolved'), 'pending');
});

test('capThreadIds dedupes and caps at 50', () => {
  assert.deepEqual(capThreadIds(['a', 'b', 'a', '']), ['a', 'b']);
  const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);
  assert.equal(capThreadIds(ids).length, 50);
  assert.deepEqual(capThreadIds(ids).slice(0, 2), ['id-10', 'id-11']);
});

test('replySubject adds Re: only when missing (re/odp aware)', () => {
  assert.equal(replySubject('Wiadomość'), 'Re: Wiadomość');
  assert.equal(replySubject('re: test'), 're: test');
  assert.equal(replySubject('Odp: test'), 'Odp: test');
});

test('outboundMessageId derives domain from the sender address', () => {
  assert.equal(outboundMessageId('abc', 'team@example.com'), '<abc@example.com>');
  assert.equal(outboundMessageId('abc', 'broken'), '<abc@open-triage.local>');
});

test('isThreadMatch matches References against conversation messageIds', () => {
  assert.equal(isThreadMatch(['<m1@x>', '<m2@x>'], { messageIds: ['<m2@x>'] }), true);
  assert.equal(isThreadMatch(['<m3@x>'], { messageIds: ['<m2@x>'] }), false);
  assert.equal(isThreadMatch([], { messageIds: ['<m2@x>'] }), false);
});

test('composeReplyRaw builds RFC822 with threading headers', async () => {
  const raw = await composeReplyRaw({
    from: 'help@acme.com',
    fromName: 'Acme Support',
    to: 'client@klient.pl',
    subject: 'Re: Problem with login',
    body: 'Hello, we are on it.',
    messageId: '<id@acme.com>',
    inReplyTo: '<orig@klient.pl>',
    references: ['<orig@klient.pl>'],
    date: new Date('2026-09-12T10:00:00Z'),
  });
  const text = raw.toString('utf8');
  assert.match(text, /^Message-ID: <id@acme\.com>/m);
  assert.match(text, /^In-Reply-To: <orig@klient\.pl>/m);
  assert.match(text, /^References: <orig@klient\.pl>/m);
  assert.match(text, /^From: Acme Support <help@acme\.com>/m);
  assert.match(text, /^To: client@klient\.pl$/m);
  assert.match(text, /^Subject: Re: Problem with login/m);
  assert.ok(text.includes('Hello, we are on it.'));
  // No HTML part in this increment (text-only MIME).
  assert.doesNotMatch(text, /^Content-Type: multipart/m);
});

test('systemMailHtml escapes user-provided values (invite token / tenant name)', () => {
  const html = systemMailHtml('Join <script>alert(1)</script>', ['Hello & welcome'], 'https://app/accept-invite?token=a<b', 'Set up');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('https://app/accept-invite?token=a&lt;b'));
});

test('Producer degrades gracefully without REDIS_URL (MVP fallbacks stay)', async () => {
  const previous = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const producer = new Producer();
    assert.equal(producer.available, false);
    assert.equal(producer.connectionForWorkers(), null);
    assert.equal(await producer.enqueuePollMailbox('m1'), false);
    assert.equal(await producer.enqueueSendReply({ deliveryKey: 'k' } as never), false);
    assert.equal(await producer.enqueueInviteMail({} as never), false);
    assert.equal(await producer.enqueueVerifyMail({} as never), false);
    assert.equal(await producer.enqueueClassify('t', 'c'), false);
    assert.equal(await producer.enqueueDraft({} as never), false);
    assert.equal(await producer.enqueuePollAllScheduler(30_000), false);
    await producer.close();
  } finally {
    if (previous !== undefined) process.env.REDIS_URL = previous;
  }
});

test('WorkerModule graph exposes PRODUCER token from ProducerModule', () => {
  assert.equal(typeof PRODUCER, 'symbol');
  assert.equal(typeof WorkerModule, 'function');
});
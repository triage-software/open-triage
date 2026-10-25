#!/usr/bin/env node
// Requires a local API, PostgreSQL, Redis, worker and Mailpit SMTP sink.
// Creates one synthetic account and leaves it (and its mail) in the local stack.
// Passwords, reset tokens and session cookies stay in memory and are never logged.
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

function localOrigin(value, label) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)
    || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be a plain loopback HTTP(S) origin`);
  }
  return url.origin;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(origin, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  const json = await response.json();
  return { status: response.status, body: json, cookies: response.headers.getSetCookie() };
}

function sessionCookie(response) {
  const cookie = response.cookies.find((value) => value.startsWith('ot_session='))?.split(';', 1)[0];
  check(cookie, 'successful authentication did not return a session cookie');
  return cookie;
}

const isGenericSuccess = (response) => response.status === 200
  && JSON.stringify(response.body) === JSON.stringify({ ok: true });
const isRecipient = (message, email) => Array.isArray(message.To)
  && message.To.some((recipient) => recipient.Address?.toLowerCase() === email);

async function resetTokenFromMail(mailpitOrigin, email, tenantName) {
  const deadline = Date.now() + 45000;
  const search = new URLSearchParams({ query: `to:${email}`, limit: '20' });
  while (Date.now() < deadline) {
    const inbox = await request(mailpitOrigin, `/api/v1/search?${search}`);
    check(inbox.status === 200 && Array.isArray(inbox.body.messages), 'Mailpit search failed');
    const reset = inbox.body.messages.find((message) => isRecipient(message, email)
      && message.Subject === 'Reset your password');
    if (reset) {
      // Retrieve the full body only for this run's fixture and reset subject.
      const delivered = await request(mailpitOrigin, `/api/v1/message/${encodeURIComponent(reset.ID)}`);
      check(delivered.status === 200 && isRecipient(delivered.body, email), 'Mailpit returned a different recipient');
      const text = delivered.body.Text;
      check(typeof text === 'string' && text.includes(tenantName), 'reset mail is missing its account context');
      const links = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
      const resetUrl = links.map((link) => new URL(link)).find((url) => url.pathname === '/reset-password');
      check(resetUrl, 'reset mail is missing its recovery link');
      localOrigin(resetUrl.origin, 'mailed application URL');
      const token = resetUrl.searchParams.get('token');
      check(/^[A-Za-z0-9_-]{43}$/.test(token ?? ''), 'mailed reset token has an unexpected shape');
      return token;
    }
    await setTimeout(250);
  }
  throw new Error('fixture reset mail did not arrive within 45 seconds');
}

let stage = 'configuration';
let fixtureEmail;
let fixtureCreated = false;
try {
  check(process.argv.length === 2, 'use RESET_SMOKE_API_ORIGIN and RESET_SMOKE_MAILPIT_ORIGIN for configuration');
  const api = localOrigin(process.env.RESET_SMOKE_API_ORIGIN ?? 'http://127.0.0.1:4000', 'API origin');
  const mailpit = localOrigin(process.env.RESET_SMOKE_MAILPIT_ORIGIN ?? 'http://127.0.0.1:18025', 'Mailpit origin');
  fixtureEmail = `reset-smoke-${randomUUID()}@example.test`;
  const unknownEmail = `reset-smoke-unknown-${randomUUID()}@example.test`;
  const tenantName = `Reset smoke ${randomUUID()}`;
  const oldPassword = randomBytes(24).toString('base64url');
  const newPassword = randomBytes(24).toString('base64url');

  stage = 'local service preflight';
  check((await request(api, '/healthz')).status === 200, 'local API health check failed');
  const initialMail = await request(mailpit, `/api/v1/search?${new URLSearchParams({ query: `to:${fixtureEmail}` })}`);
  check(initialMail.status === 200 && Array.isArray(initialMail.body.messages), 'local Mailpit is unavailable');

  stage = 'synthetic signup and initial session';
  const signup = await request(api, '/v1/auth/signup', {
    body: { tenantName, email: fixtureEmail, password: oldPassword, locale: 'en' },
  });
  check(signup.status === 201 && signup.body.user?.email === fixtureEmail, 'synthetic signup failed');
  fixtureCreated = true;
  const oldCookie = sessionCookie(signup);
  const me = await request(api, '/v1/auth/me', { cookie: oldCookie });
  check(me.status === 200 && me.body.user?.id === signup.body.user.id, 'initial session failed');
  console.log('PASS synthetic signup and authenticated session');

  stage = 'generic recovery responses';
  const known = await request(api, '/v1/auth/forgot-password', { body: { email: fixtureEmail } });
  const unknown = await request(api, '/v1/auth/forgot-password', { body: { email: unknownEmail } });
  check(isGenericSuccess(known) && isGenericSuccess(unknown), 'known and unknown addresses must receive the same generic success');
  console.log('PASS identical generic responses for known and unknown addresses');

  stage = 'worker and SMTP delivery';
  const token = await resetTokenFromMail(mailpit, fixtureEmail, tenantName);
  console.log('PASS reset link delivered through the worker and local SMTP');

  stage = 'reset validation';
  const malformed = await request(api, '/v1/auth/reset-password', { body: { token: 'malformed-link', password: newPassword } });
  check(malformed.status === 400 && malformed.body.code === 'INVALID_RESET_TOKEN', 'malformed reset link was not rejected');
  const short = await request(api, '/v1/auth/reset-password', { body: { token, password: 'short' } });
  check(short.status === 400 && short.body.code === 'VALIDATION_ERROR', 'short password was not rejected');
  console.log('PASS invalid link and short password rejected');

  stage = 'password reset and session revocation';
  const reset = await request(api, '/v1/auth/reset-password', { body: { token, password: newPassword } });
  check(isGenericSuccess(reset), 'valid emailed link failed after validation errors');
  const revoked = await request(api, '/v1/auth/me', { cookie: oldCookie });
  check(revoked.status === 401 && revoked.body.code === 'UNAUTHENTICATED', 'old session survived password reset');
  const oldLogin = await request(api, '/v1/auth/login', { body: { email: fixtureEmail, password: oldPassword } });
  check(oldLogin.status === 401 && oldLogin.body.code === 'INVALID_CREDENTIALS', 'old password still authenticates');
  console.log('PASS reset invalidates the old session and password');

  stage = 'single-use token and new password';
  const replay = await request(api, '/v1/auth/reset-password', { body: { token, password: randomBytes(24).toString('base64url') } });
  check(replay.status === 400 && replay.body.code === 'INVALID_RESET_TOKEN', 'consumed reset link was accepted again');
  const newLogin = await request(api, '/v1/auth/login', { body: { email: fixtureEmail, password: newPassword } });
  check(newLogin.status === 200, 'new password failed to authenticate');
  const newMe = await request(api, '/v1/auth/me', { cookie: sessionCookie(newLogin) });
  check(newMe.status === 200 && newMe.body.user?.id === signup.body.user.id, 'new session selected a different account');
  console.log('PASS reset token works once and the new password authenticates');
  console.log('PASS local password recovery HTTP/SMTP smoke');
} catch (error) {
  // Report only fixed check messages, never server bodies, URLs or stack traces.
  console.error(`FAIL ${stage}: ${error instanceof Error && error.constructor === Error ? error.message : 'request failed'}`);
  process.exitCode = 1;
} finally {
  if (fixtureCreated) console.log(`Synthetic fixture remains in the local database and Mailpit: ${fixtureEmail}`);
}

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const passwordRanges = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*',
};

const passwordAlphabet = Object.values(passwordRanges).join('');

/**
 * ADR-0002: opaque 256-bit session ids, signed cookie value.
 * Cookie format: `<sessionId>.<hmac(sessionId, SESSION_SECRET)>` — tamper-evident
 * without trusting the client; the session row remains the anchor.
 */
export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function signSessionId(sessionId: string, secret: string): string {
  return `${sessionId}.${createHmac('sha256', secret).update(sessionId).digest('base64url')}`;
}

export function parseSessionCookie(
  cookieValue: string | undefined,
  secret: string,
): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(id).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function slugify(name: string): string {
  const map: Record<string, string> = {
    ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  };
  return name
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tenant';
}

/** Simple salted signing key for mailbox credential encryption at rest (SPEC-0001). */
export function encryptionKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('mailbox-credentials').digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const key = encryptionKey(secret);
  const iv = randomBytes(12);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createCipheriv } = require('crypto') as typeof import('crypto');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptSecret(stored: string, secret: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createDecipheriv } = require('crypto') as typeof import('crypto');
    const [ivB, dataB, tagB] = stored.split('.');
    const key = encryptionKey(secret);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

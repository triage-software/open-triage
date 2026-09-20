import 'server-only';
import type { cookies as cookiesFn } from 'next/headers';

// BFF: server-to-server calls to the Nest API (SPEC-0001). Session cookie is
// forwarded; the browser never talks to the API directly.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export async function apiFetch(
  path: string,
  init: RequestInit & { cookies?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown; setCookie: string[] }> {
  const { cookies, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  if (cookies) {
    const pairs = Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    const existing = h.get('cookie');
    h.set('cookie', existing ? `${existing}; ${pairs.join('; ')}` : pairs.join('; '));
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: h,
    cache: 'no-store',
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  // getSetCookie() keeps multiple Set-Cookie headers distinct; header.get()
  // would comma-join them, which breaks Expires="...GMT" parsing. Fall back
  // to get() if the runtime's fetch doesn't expose getSetCookie().
  let setCookie: string[] = [];
  if (typeof res.headers.getSetCookie === 'function') {
    setCookie = res.headers.getSetCookie();
  } else {
    const single = res.headers.get('set-cookie');
    if (single) setCookie = [single];
  }
  return { status: res.status, body, setCookie };
}

/**
 * Relays a Set-Cookie header from a server-to-server apiFetch response onto
 * the browser response. Needed because a Server Action's own fetch to the
 * Nest API never reaches the browser — unlike src/app/api/proxy, which can
 * copy the header directly onto its NextResponse (SPEC-0001 BFF: the API's
 * `ot_session` cookie is the auth anchor, ADR-0002).
 */
export function relaySetCookies(jar: Awaited<ReturnType<typeof cookiesFn>>, setCookie: string[]) {
  for (const raw of setCookie) {
    const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);

    const options: {
      path?: string;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      maxAge?: number;
      expires?: Date;
    } = {};
    for (const attr of attrs) {
      const [rawKey, rawVal] = attr.split('=');
      const key = rawKey.trim().toLowerCase();
      const val = rawVal?.trim();
      if (key === 'path') options.path = val;
      else if (key === 'httponly') options.httpOnly = true;
      else if (key === 'secure') options.secure = true;
      else if (key === 'samesite' && val) options.sameSite = val.toLowerCase() as 'lax' | 'strict' | 'none';
      else if (key === 'max-age' && val) options.maxAge = Number(val);
      else if (key === 'expires' && val) options.expires = new Date(val);
    }
    jar.set(name, value, options);
  }
}

export function errorOf(body: unknown): string {
  if (body && typeof body === 'object' && 'code' in body) {
    return String((body as { code: unknown }).code);
  }
  return 'GENERIC_ERROR';
}

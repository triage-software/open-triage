import 'server-only';

// BFF: server-to-server calls to the Nest API (SPEC-0001). Session cookie is
// forwarded; the browser never talks to the API directly.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export async function apiFetch(
  path: string,
  init: RequestInit & { cookies?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
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
  return { status: res.status, body };
}

export function errorOf(body: unknown): string {
  if (body && typeof body === 'object' && 'code' in body) {
    return String((body as { code: unknown }).code);
  }
  return 'GENERIC_ERROR';
}

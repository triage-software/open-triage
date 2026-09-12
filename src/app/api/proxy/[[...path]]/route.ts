import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * BFF proxy: forwards /api/* from the browser to the Nest API `/v1/*`,
 * attaching the session cookie. SPEC-0001: the browser never talks to the
 * API directly.
 */
async function proxy(req: NextRequest, path: string) {
  const url = new URL(req.url);
  const target = `${API_URL}/v1${path}${url.search}`;
  const headers = new Headers();
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    headers.set('content-type', req.headers.get('content-type') ?? 'application/json');
  }

  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
    cache: 'no-store',
  });

  const out = new NextResponse(res.body, { status: res.status });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) out.headers.set('set-cookie', setCookie);
  out.headers.set('content-type', res.headers.get('content-type') ?? 'application/json');
  return out;
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, `/${(path ?? []).join('/')}`);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, `/${(path ?? []).join('/')}`);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, `/${(path ?? []).join('/')}`);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, `/${(path ?? []).join('/')}`);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, `/${(path ?? []).join('/')}`);
}

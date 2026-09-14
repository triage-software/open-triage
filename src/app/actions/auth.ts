'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch, errorOf } from '@/lib/api-client';

export type AuthState = { error?: string };

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const locale = String(formData.get('locale') ?? 'en');

  const jar = await cookies();
  const { status, body } = await apiFetch('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (status !== 200) {
    const code = errorOf(body);
    return { error: code === 'INVALID_CREDENTIALS' ? 'invalidCredentials' : 'genericError' };
  }

  // ADR-0004: locale from session — store the user's chosen locale
  jar.set('ot_locale', locale, { httpOnly: false, sameSite: 'lax', path: '/' });
  redirect('/');
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const tenantName = String(formData.get('tenantName') ?? '');
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const locale = String(formData.get('locale') ?? 'en');

  if (password.length < 10) return { error: 'passwordTooShort' };

  const jar = await cookies();
  const { status, body } = await apiFetch('/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ tenantName, email, password, locale }),
  });

  if (status !== 201) {
    const code = errorOf(body);
    return { error: code === 'EMAIL_TAKEN' ? 'emailTaken' : 'genericError' };
  }

  jar.set('ot_locale', locale, { httpOnly: false, sameSite: 'lax', path: '/' });
  redirect('/');
}

export async function logoutAction() {
  const jar = await cookies();
  await apiFetch('/v1/auth/logout', {
    method: 'POST',
    cookies: Object.fromEntries(jar.getAll().map((c) => [c.name, c.value])),
  });
  jar.delete('ot_locale');
  redirect('/sign-in');
}

/** QA-3: invited teammate completes signup (one-time setup token + password). */
export async function acceptInviteAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const locale = String(formData.get('locale') ?? 'en');

  if (password.length < 10) return { error: 'passwordTooShort' };

  const jar = await cookies();
  const { status, body } = await apiFetch('/v1/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token, password, ...(name ? { name } : {}) }),
  });

  if (status !== 200) {
    const code = errorOf(body);
    if (code === 'INVALID_TOKEN') return { error: 'invalidInviteToken' };
    if (code === 'TENANT_SUSPENDED') return { error: 'tenantSuspended' };
    return { error: 'genericError' };
  }

  jar.set('ot_locale', locale, { httpOnly: false, sameSite: 'lax', path: '/' });
  redirect('/');
}

export async function setLocaleAction(locale: string) {
  const jar = await cookies();
  if (locale === 'en' || locale === 'pl') {
    jar.set('ot_locale', locale, { httpOnly: false, sameSite: 'lax', path: '/' });
  }
}

export type VerifyState = { error?: string; verified?: boolean };

/** POST /v1/auth/verify {token} — no redirect on success, the page shows a
 *  confirmation + link instead. */
export async function verifyAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const token = String(formData.get('token') ?? '');

  const { status, body } = await apiFetch('/v1/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

  if (status !== 200) {
    const code = errorOf(body);
    return { error: code === 'INVALID_TOKEN' ? 'invalidVerifyToken' : 'genericError' };
  }
  return { verified: true };
}

export type ResendState = { ok: boolean; alreadyVerified?: boolean; error?: string };

/** POST /v1/auth/resend-verification — session-cookie-authenticated, only
 *  meaningful for a signed-in user; a non-200 (e.g. unauthenticated) surfaces
 *  a generic error. */
export async function resendVerificationAction(): Promise<ResendState> {
  const jar = await cookies();
  const { status, body } = await apiFetch('/v1/auth/resend-verification', {
    method: 'POST',
    cookies: Object.fromEntries(jar.getAll().map((c) => [c.name, c.value])),
  });

  if (status !== 200) return { ok: false, error: 'genericError' };
  const alreadyVerified = (body as { alreadyVerified?: boolean } | null)?.alreadyVerified;
  return { ok: true, alreadyVerified };
}

'use server';

import { z } from 'zod';
import { apiFetch, errorOf } from '@/lib/api-client';

export type PasswordResetState = { error?: string; success?: boolean };

const emailSchema = z.string().trim().email('invalidEmail').max(254, 'invalidEmail');
const resetSchema = z.object({
  token: z.string().min(1, 'invalidResetToken'),
  password: z.string().min(10, 'passwordTooShort').max(200, 'passwordTooLong'),
  confirmPassword: z.string(),
}).refine(({ password, confirmPassword }) => password === confirmPassword, {
  message: 'passwordMismatch',
});

export async function forgotPasswordAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const email = emailSchema.safeParse(formData.get('email'));
  if (!email.success) return { error: 'invalidEmail' };

  try {
    const { status, body } = await apiFetch('/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: email.data }),
      signal: AbortSignal.timeout(10_000),
    });
    if (status === 200) return { success: true };
    return { error: errorOf(body) === 'RESET_UNAVAILABLE' ? 'resetUnavailable' : 'genericError' };
  } catch {
    return { error: 'genericError' };
  }
}

export async function resetPasswordAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsed = resetSchema.safeParse({
    token: String(formData.get('token') ?? ''),
    password: String(formData.get('password') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const { token, password } = parsed.data;
    const { status, body } = await apiFetch('/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (status === 200) return { success: true };
    return { error: errorOf(body) === 'INVALID_RESET_TOKEN' ? 'invalidResetToken' : 'genericError' };
  } catch {
    return { error: 'genericError' };
  }
}

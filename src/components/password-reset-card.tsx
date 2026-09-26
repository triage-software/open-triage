'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import {
  forgotPasswordAction,
  resetPasswordAction,
  type PasswordResetState,
} from '@/app/actions/password-reset';

export function PasswordResetCard({ mode, token }: { mode: 'request' | 'reset'; token?: string }) {
  const t = useTranslations('auth');
  const action = mode === 'request' ? forgotPasswordAction : resetPasswordAction;
  const [state, formAction, pending] = useActionState<PasswordResetState, FormData>(action, {});
  const invalidToken = mode === 'reset' && (!token || state.error === 'invalidResetToken');

  return (
    <div className="auth-card">
      <h1>{mode === 'request' ? t('forgotPasswordTitle') : t('resetPasswordTitle')}</h1>
      {state.success ? (
        <p role="status">{mode === 'request' ? t('resetRequested') : t('resetComplete')}</p>
      ) : invalidToken ? (
        <div className="auth-form">
          <p className="auth-error" role="alert">{t('invalidResetToken')}</p>
          <Link href="/forgot-password">{t('requestNewReset')}</Link>
        </div>
      ) : (
        <form action={formAction} className="auth-form">
          {mode === 'request' ? (
            <>
              <p>{t('forgotPasswordDescription')}</p>
              <label>
                <span>{t('email')}</span>
                <input name="email" type="email" required maxLength={254} autoComplete="email" />
              </label>
            </>
          ) : (
            <>
              <input name="token" type="hidden" value={token} />
              <label>
                <span>{t('newPassword')}</span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  maxLength={200}
                  autoComplete="new-password"
                  aria-describedby="reset-password-hint"
                />
                <small id="reset-password-hint">{t('resetPasswordHint')}</small>
              </label>
              <label>
                <span>{t('confirmPassword')}</span>
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={10}
                  maxLength={200}
                  autoComplete="new-password"
                />
              </label>
            </>
          )}
          {state.error && <p className="auth-error" role="alert">{t(state.error)}</p>}
          <button type="submit" className="btn-primary" disabled={pending}>
            {mode === 'request'
              ? t(pending ? 'sendingReset' : 'submitForgotPassword')
              : t(pending ? 'savingPassword' : 'submitResetPassword')}
          </button>
        </form>
      )}
      <p><Link href="/sign-in">{t('backToSignIn')}</Link></p>
    </div>
  );
}

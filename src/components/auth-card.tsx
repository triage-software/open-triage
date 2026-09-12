'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { signInAction, signUpAction, type AuthState } from '@/app/actions/auth';

export function AuthCard({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const t = useTranslations('auth');
  const action = mode === 'sign-in' ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});

  return (
    <div className="auth-card">
      <h1>{mode === 'sign-in' ? t('signInTitle') : t('signUpTitle')}</h1>
      <form action={formAction} className="auth-form">
        {mode === 'sign-up' && (
          <label>
            <span>{t('tenantName')}</span>
            <input name="tenantName" type="text" required minLength={2} maxLength={80} autoComplete="organization" />
          </label>
        )}
        <label>
          <span>{t('email')}</span>
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          <span>{t('password')}</span>
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'sign-up' ? 10 : 1}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          />
          {mode === 'sign-up' && <small>{t('passwordHint')}</small>}
        </label>
        <input type="hidden" name="locale" value="en" />
        {state.error && (
          <p className="auth-error" role="alert">
            {t(state.error)}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={pending}>
          {mode === 'sign-in' ? t('submitSignIn') : t('submitSignUp')}
        </button>
      </form>
    </div>
  );
}

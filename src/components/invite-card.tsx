'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { acceptInviteAction, type AuthState } from '@/app/actions/auth';

/** QA-3: one-time invite setup — invited teammate sets name + password.
 *  Reachable at /accept-invite?token=… (token comes from the inviting admin,
 *  MVP has no invite e-mail delivery yet). */
export function InviteCard({ token }: { token: string }) {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState<AuthState, FormData>(acceptInviteAction, {});

  return (
    <div className="auth-card">
      <h1>{t('acceptInviteTitle')}</h1>
      <form action={formAction} className="auth-form">
        <input type="hidden" name="token" value={token} />
        <label>
          <span>{t('name')}</span>
          <input name="name" type="text" maxLength={120} autoComplete="name" />
        </label>
        <label>
          <span>{t('password')}</span>
          <input
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
          <small>{t('passwordHint')}</small>
        </label>
        <input type="hidden" name="locale" value="en" />
        {state.error && (
          <p className="auth-error" role="alert">
            {t(state.error)}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={pending}>
          {t('submitAcceptInvite')}
        </button>
      </form>
    </div>
  );
}

'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { verifyAction, resendVerificationAction, type VerifyState } from '@/app/actions/auth';

const REDIRECT_DELAY_MS = 1200;

/** /verify?token=… card — auto-submits verifyAction on mount (the user
 *  already confirmed intent by clicking the e-mail link, no button needed). */
export function VerifyCard({ token, signedIn }: { token: string; signedIn: boolean }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [state, formAction] = useActionState<VerifyState, FormData>(verifyAction, {});
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const fd = new FormData();
    fd.set('token', token);
    formAction(fd);
  }, [token, formAction]);

  // Signed-in users just verified their account and belong in the app;
  // a visitor verifying from an unauthenticated browser goes to sign in.
  useEffect(() => {
    if (!state.verified) return;
    const timer = setTimeout(() => router.push(signedIn ? '/' : '/sign-in'), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.verified, signedIn, router]);

  const [resendPending, startResend] = useTransition();
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState(false);

  function handleResend() {
    if (resendPending || resendSent) return;
    setResendError(false);
    startResend(async () => {
      const res = await resendVerificationAction();
      if (res.ok) setResendSent(true);
      else setResendError(true);
    });
  }

  return (
    <div className="auth-card">
      <h1>{t('verifyTitle')}</h1>

      {!state.verified && !state.error && <p>{t('verifying')}</p>}

      {state.verified && (
        <div className="auth-result">
          <p className="auth-success" role="status">
            {t('verifySuccess')}
          </p>
          <Link href={signedIn ? '/' : '/sign-in'} className="btn-primary">
            {t('verifySuccessCta')}
          </Link>
        </div>
      )}

      {state.error && (
        <div className="auth-result">
          <p className="auth-error" role="alert">
            {t(state.error)}
          </p>
          {signedIn && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleResend}
                disabled={resendPending || resendSent}
              >
                {resendPending ? t('resending') : resendSent ? t('resendSent') : t('resend')}
              </button>
              {resendError && (
                <p className="auth-error" role="alert">
                  {t('genericError')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

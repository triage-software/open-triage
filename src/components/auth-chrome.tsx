'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { setLocaleAction } from '@/app/actions/auth';

// ADR-0004: EN/PL language toggle — sets ot_locale cookie, server re-renders.
export function LanguageToggle({ current }: { current: string }) {
  const t = useTranslations('lang');
  const [pending, startTransition] = useTransition();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {(['en', 'pl'] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={current === l}
          className={current === l ? 'lang-active' : undefined}
          onClick={() => startTransition(() => setLocaleAction(l))}
        >
          {t(l)}
        </button>
      ))}
    </div>
  );
}

export function AuthSwitch({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const t = useTranslations('auth');
  return mode === 'sign-in' ? (
    <p>
      {t('noAccount')} <Link href="/sign-up">{t('signUp')}</Link>
    </p>
  ) : (
    <p>
      {t('haveAccount')} <Link href="/sign-in">{t('signIn')}</Link>
    </p>
  );
}

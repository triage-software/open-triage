import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { VerifyCard } from '@/components/verify-card';
import { LanguageToggle } from '@/components/auth-chrome';
import { apiFetch } from '@/lib/api-client';

/** /verify?token=… — landed on from the verification e-mail link (see
 *  api/src/worker/notifications.service.ts sendVerifyMail). Does NOT redirect
 *  a signed-in user away: they may legitimately land here to confirm. */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const jar = await cookies();
  const cookieHeader = Object.fromEntries(jar.getAll().map((c) => [c.name, c.value]));
  const { status } = await apiFetch('/v1/auth/me', { cookies: cookieHeader });
  const signedIn = status === 200;

  const locale = jar.get('ot_locale')?.value ?? 'en';
  const t = await getTranslations('auth');

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <strong>open-triage</strong>
        <p>Shared-inbox triage for teams.</p>
      </div>
      <div className="auth-panel">
        <LanguageToggle current={locale} />
        {token ? (
          <VerifyCard token={token} signedIn={signedIn} />
        ) : (
          <p className="auth-error" role="alert">
            {t('verifyMissingToken')}
          </p>
        )}
      </div>
    </main>
  );
}

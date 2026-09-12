import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { InviteCard } from '@/components/invite-card';
import { LanguageToggle } from '@/components/auth-chrome';
import { apiFetch } from '@/lib/api-client';

/** QA-3: /accept-invite?token=… — one-time setup page for invited teammates. */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // Already-signed-in users don't need the invite flow.
  const jar = await cookies();
  const { status } = await apiFetch('/v1/auth/me', {
    cookies: Object.fromEntries(jar.getAll().map((c) => [c.name, c.value])),
  });
  if (status === 200) redirect('/');

  const locale = jar.get('ot_locale')?.value ?? 'en';
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <strong>open-triage</strong>
        <p>Shared-inbox triage for teams.</p>
      </div>
      <div className="auth-panel">
        <LanguageToggle current={locale} />
        {token ? (
          <InviteCard token={token} />
        ) : (
          <p className="auth-error" role="alert">
            Missing invite token.
          </p>
        )}
      </div>
    </main>
  );
}

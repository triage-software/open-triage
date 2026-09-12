import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { AuthCard } from '@/components/auth-card';
import { AuthSwitch, LanguageToggle } from '@/components/auth-chrome';
import { apiFetch } from '@/lib/api-client';

export default async function SignInPage() {
  const jar = await cookies();
  const { status } = await apiFetch('/v1/auth/me', {
    cookies: Object.fromEntries(jar.getAll().map((c) => [c.name, c.value])),
  });
  if (status === 200) redirect('/');

  const t = await getTranslations('auth');
  const locale = jar.get('ot_locale')?.value ?? 'en';
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <strong>open-triage</strong>
        <p>Shared-inbox triage for teams.</p>
      </div>
      <div className="auth-panel">
        <LanguageToggle current={locale} />
        <AuthCard mode="sign-in" />
        <AuthSwitch mode="sign-in" />
      </div>
     <span className="sr-only">{t('signIn')}</span>
    </main>
  );
}

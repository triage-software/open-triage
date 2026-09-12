import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { AuthCard } from '@/components/auth-card';
import { AuthSwitch, LanguageToggle } from '@/components/auth-chrome';
import { apiFetch } from '@/lib/api-client';

export default async function SignUpPage() {
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
        <AuthCard mode="sign-up" />
        <AuthSwitch mode="sign-up" />
      </div>
    </main>
  );
}

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { WorkspaceShell } from '@/components/workspace-shell';
import { LanguageToggle } from '@/components/auth-chrome';
import { logoutAction } from '@/app/actions/auth';

export default async function HomePage() {
  const jar = await cookies();
  const cookieHeader = Object.fromEntries(jar.getAll().map((c) => [c.name, c.value]));
  const { status, body } = await apiFetch('/v1/auth/me', { cookies: cookieHeader });

  if (status !== 200) redirect('/sign-in');
  const me = body as {
    user?: { id: string; email: string; role: string; name: string | null; locale: string; emailVerified: boolean };
    tenant?: { id: string; name: string; plan: string };
    platformAdmin?: { email: string };
  };

  // Platform admins land on the admin console (SPEC-0001: separate surface)
  if (me.platformAdmin) redirect('/admin');

  const t = await getTranslations('nav');
  const locale = me.user?.locale ?? jar.get('ot_locale')?.value ?? 'en';

  return (
    <WorkspaceShell
      user={{ email: me.user!.email, name: me.user!.name, role: me.user!.role }}
      tenant={{ name: me.tenant!.name }}
      locale={locale}
      emailVerified={me.user!.emailVerified}
      logoutAction={logoutAction}
      chrome={<LanguageToggle current={locale} />}
      labels={{
        inbox: t('inbox'),
        knowledge: t('knowledge'),
        team: t('team'),
        settings: t('settings'),
        logout: t('logout'),
      }}
    />
  );
}

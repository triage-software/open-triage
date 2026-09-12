import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { WorkspacePage, type PageUser } from '@/components/workspace-page';
import { SettingsView } from '@/components/settings-view';
import { LanguageToggle } from '@/components/auth-chrome';
import { logoutAction } from '@/app/actions/auth';

export default async function SettingsPage() {
  const jar = await cookies();
  const cookieHeader = Object.fromEntries(jar.getAll().map((c) => [c.name, c.value]));
  const { status, body } = await apiFetch('/v1/auth/me', { cookies: cookieHeader });

  if (status !== 200) redirect('/sign-in');
  const me = body as {
    user?: PageUser;
    tenant?: { name: string };
  };
  if (!me.user) redirect('/admin');

  const tNav = await getTranslations('nav');
  const tSettings = await getTranslations('settings');
  const locale = jar.get('ot_locale')?.value ?? 'en';

  return (
    <WorkspacePage
      user={me.user}
      tenant={me.tenant?.name ?? ''}
      labels={{
        inbox: tNav('inbox'),
        knowledge: tNav('knowledge'),
        team: tNav('team'),
        settings: tNav('settings'),
        title: tSettings('title'),
        subtitle: tSettings('subtitle'),
      }}
      active="/settings"
    >
      <SettingsView
        user={me.user}
        tenant={me.tenant?.name ?? ''}
        locale={locale}
        chrome={
          <>
            <LanguageToggle current={locale} />
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary">
                {tNav('logout')}
              </button>
            </form>
          </>
        }
      />
    </WorkspacePage>
  );
}

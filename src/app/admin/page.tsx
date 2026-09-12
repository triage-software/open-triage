import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { AdminConsole } from '@/components/admin-console';
import { LanguageToggle } from '@/components/auth-chrome';

export default async function AdminPage() {
  const jar = await cookies();
  const cookieHeader = Object.fromEntries(jar.getAll().map((c) => [c.name, c.value]));
  const { status, body } = await apiFetch('/v1/auth/me', { cookies: cookieHeader });
  const me = body as { platformAdmin?: { email: string } } | null;

  if (status !== 200 || !me?.platformAdmin) redirect('/sign-in');

  const t = await getTranslations('admin');
  const locale = jar.get('ot_locale')?.value ?? 'en';

  return (
    <AdminConsole
      adminEmail={me.platformAdmin.email}
      locale={locale}
      chrome={<LanguageToggle current={locale} />}
      labels={{
        title: t('title'),
        tenants: t('tenants'),
        users: t('users'),
        settings: t('settings'),
        searchPlaceholder: t('searchPlaceholder'),
        plan: t('plan'),
        status: t('status'),
        active: t('active'),
        suspended: t('suspended'),
        created: t('created'),
        conversations: t('conversations'),
        members: t('members'),
        suspend: t('suspend'),
        activate: t('activate'),
        aiModel: t('aiModel'),
        aiEnabled: t('aiEnabled'),
        save: t('save'),
        saved: t('saved'),
      }}
    />
  );
}

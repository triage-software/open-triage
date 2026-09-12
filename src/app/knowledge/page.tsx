import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { WorkspacePage, type PageUser } from '@/components/workspace-page';
import { KnowledgeView } from '@/components/knowledge-view';

export default async function KnowledgePage() {
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
  const tKb = await getTranslations('knowledge');
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
        title: tKb('title'),
        subtitle: tKb('subtitle'),
      }}
      active="/knowledge"
    >
      <KnowledgeView
        canManage={me.user.role === 'admin' || me.user.role === 'owner'}
      />
    </WorkspacePage>
  );
}

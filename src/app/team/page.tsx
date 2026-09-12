import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { WorkspacePage, type PageUser } from '@/components/workspace-page';
import { TeamView } from '@/components/team-view';

export default async function TeamPage() {
  const jar = await cookies();
  const cookieHeader = Object.fromEntries(jar.getAll().map((c) => [c.name, c.value]));
  const { status, body } = await apiFetch('/v1/auth/me', { cookies: cookieHeader });

  if (status !== 200) redirect('/sign-in');
  const me = body as {
    user?: PageUser;
    tenant?: { name: string };
  };
  if (!me.user) redirect('/admin');
  // API is admin-only (@MinRole('admin') on UsersController); agents get the
  // same 403 UI hides nothing for them — redirect to the inbox instead.
  if (me.user.role === 'agent') redirect('/');

  const tNav = await getTranslations('nav');
  const tTeam = await getTranslations('team');

  return (
    <WorkspacePage
      user={me.user}
      tenant={me.tenant?.name ?? ''}
      labels={{
        inbox: tNav('inbox'),
        knowledge: tNav('knowledge'),
        team: tNav('team'),
        settings: tNav('settings'),
        title: tTeam('title'),
        subtitle: tTeam('subtitle'),
      }}
      active="/team"
    >
      <TeamView />
    </WorkspacePage>
  );
}

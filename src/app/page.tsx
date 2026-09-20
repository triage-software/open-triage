import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api-client';
import { ApiSupportApp } from '@/components/workspace/api-data-context';
import { logoutAction } from '@/app/actions/auth';

export default async function HomePage() {
  const jar = await cookies();
  const cookieHeader = Object.fromEntries(jar.getAll().map((c) => [c.name, c.value]));
  const { status, body } = await apiFetch('/v1/auth/me', { cookies: cookieHeader });

  if (status !== 200) redirect('/sign-in');
  const me = body as {
    user?: { id: string; email: string; role: string; name: string | null; locale: string };
    tenant?: { id: string; name: string; plan: string };
    platformAdmin?: { email: string };
  };

  // Platform admins land on the admin console (SPEC-0001: separate surface)
  if (me.platformAdmin) redirect('/admin');

  return (
    <Suspense
      fallback={<div className="boot-screen">Otwieramy wspólną skrzynkę…</div>}
    >
      <ApiSupportApp
        session={{
          id: me.user!.id,
          email: me.user!.email,
          name: me.user!.name,
          role: me.user!.role,
          locale: me.user!.locale,
        }}
        tenantName={me.tenant!.name}
        logoutAction={logoutAction}
      />
    </Suspense>
  );
}

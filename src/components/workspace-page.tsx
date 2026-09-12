'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export type PageUser = {
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'agent';
};

export type PageLabels = Record<string, string>;

/** Wrapper content for sidebar-linked workspace pages: same identity header
 *  + nav as WorkspaceShell, a single content column on the right. */
export function WorkspacePage({
  user,
  tenant,
  labels,
  active,
  children,
}: {
  user: PageUser;
  tenant: string;
  labels: PageLabels;
  active: '/knowledge' | '/team' | '/settings';
  children: React.ReactNode;
}) {
  const tStates = useTranslations('states');
  return (
    <div className="workspace">
      <aside className="workspace-sidebar">
        <div className="workspace-identity">
          <strong>open-triage</strong>
          <span>{tenant}</span>
        </div>
        <nav aria-label="Main">
          <Link href="/">{labels.inbox}</Link>
          <Link href="/knowledge" className={active === '/knowledge' ? 'nav-active' : undefined}>
            {labels.knowledge}
          </Link>
          <Link href="/team" className={active === '/team' ? 'nav-active' : undefined}>
            {labels.team}
          </Link>
          <Link href="/settings" className={active === '/settings' ? 'nav-active' : undefined}>
            {labels.settings}
          </Link>
        </nav>
        <div className="workspace-footer">
          <span className="workspace-user">
            {user.name ?? user.email} · {user.role}
          </span>
        </div>
      </aside>
      <section className="workspace-page" aria-label={labels.title}>
        <header>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </header>
        <div className="workspace-page-body">{children}</div>
      </section>
      <span hidden>{tStates('loading')}</span>
    </div>
  );
}

/** Load-state helpers shared by the three pages. */
export function LoadError({ retry }: { retry: () => void }) {
  const t = useTranslations('states');
  return (
    <div className="state-error" role="alert">
      <p>{t('error')}</p>
      <button type="button" onClick={retry}>
        {t('retry')}
      </button>
    </div>
  );
}

export function Loading() {
  const t = useTranslations('states');
  return <p className="skeleton-row">{t('loading')}</p>;
}

/** Small flash message that self-clears. */
export function useFlash(timeoutMs = 3000): [string | null, (msg: string | null) => void] {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), timeoutMs);
    return () => clearTimeout(id);
  }, [flash, timeoutMs]);
  return [flash, setFlash];
}

export function Flash({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <span role="status" className="chip chip-resolved">
      {msg}
    </span>
  );
}

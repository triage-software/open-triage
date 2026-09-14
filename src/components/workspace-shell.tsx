'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { resendVerificationAction } from '@/app/actions/auth';

interface WorkspaceShellProps {
  user: { email: string; name: string | null; role: string };
  tenant: { name: string };
  locale: string;
  emailVerified: boolean;
  logoutAction: () => Promise<void>;
  chrome: React.ReactNode;
  labels: { inbox: string; knowledge: string; team: string; settings: string; logout: string };
}

interface ConversationRowData {
  id: string;
  subject: string;
  status: 'open' | 'pending' | 'resolved';
  priority: string;
  customerEmail: string;
  assignee: { id: string; name: string | null; email: string } | null;
  lastMessageAt: string;
}

const statusLabelsKey: Record<string, string> = {
  open: 'statusOpen',
  pending: 'statusPending',
  resolved: 'statusResolved',
};

export function WorkspaceShell({ user, tenant, emailVerified, logoutAction, chrome, labels }: WorkspaceShellProps) {
  const t = useTranslations('inbox');
  const tStates = useTranslations('states');
  const tAuth = useTranslations('auth');
  const [conversations, setConversations] = useState<ConversationRowData[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [, startLogout] = useTransition();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [resendPending, startResend] = useTransition();
  const [resendSent, setResendSent] = useState(false);

  function handleResend() {
    if (resendPending || resendSent) return;
    startResend(async () => {
      const res = await resendVerificationAction();
      if (res.ok) setResendSent(true);
    });
  }

  useEffect(() => {
    let alive = true;
    fetch('/api/proxy/conversations')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => alive && setConversations(data.data ?? []))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const selectedConversation = conversations?.find((c) => c.id === selected) ?? null;

  return (
    <>
      {!emailVerified && !bannerDismissed && (
        <div className="verify-banner" role="status">
          <span>{tAuth('bannerUnverified')}</span>
          <div className="verify-banner-actions">
            <button type="button" onClick={handleResend} disabled={resendPending || resendSent}>
              {resendSent ? tAuth('bannerResendSent') : resendPending ? tAuth('resending') : tAuth('bannerResend')}
            </button>
            <button
              type="button"
              className="verify-banner-dismiss"
              aria-label="Dismiss"
              onClick={() => setBannerDismissed(true)}
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className="workspace">
      <aside className="workspace-sidebar">
        <div className="workspace-identity">
          <strong>open-triage</strong>
          <span>{tenant.name}</span>
        </div>
        <nav aria-label="Main">
          <a href="/" className="nav-active">{labels.inbox}</a>
          <a href="/knowledge">{labels.knowledge}</a>
          {user.role !== 'agent' && <a href="/team">{labels.team}</a>}
          <a href="/settings">{labels.settings}</a>
        </nav>
        <div className="workspace-footer">
          <span className="workspace-user">{user.name ?? user.email} · {user.role}</span>
          {chrome}
          <button type="button" onClick={() => startLogout(() => void logoutAction())}>
            {labels.logout}
          </button>
        </div>
      </aside>

      <section className="conversation-list" aria-label={t('title')}>
        {error && (
          <div className="state-error" role="alert">
            <p>{tStates('error')}</p>
            <button type="button" onClick={() => window.location.reload()}>{tStates('retry')}</button>
          </div>
        )}
        {!error && conversations === null && <p className="skeleton-row">{tStates('loading')}</p>}
        {conversations !== null && conversations.length === 0 && (
          <div className="empty-state">
            <p>{t('empty')}</p>
            <small>{t('emptyCta')}</small>
          </div>
        )}
        <ul role="listbox" aria-label={t('title')}>
          {(conversations ?? []).map((c) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c.id === selected}
              tabIndex={0}
              className={c.id === selected ? 'conv-row conv-selected' : 'conv-row'}
              onClick={() => setSelected(c.id)}
              onKeyDown={(e) => e.key === 'Enter' && setSelected(c.id)}
            >
              <div className="conv-row-top">
                <span className="conv-subject">{c.subject}</span>
                <StatusChip status={c.status} label={t(`status${cap(c.status)}` as Parameters<typeof t>[0])} />
              </div>
              <div className="conv-row-bottom">
                <span>{c.customerEmail}</span>
                <span>{c.assignee?.name ?? ''}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="thread-pane">
        {selectedConversation ? (
          <ThreadPanel conversationId={selectedConversation.id} labels={{
            reply: t('reply'),
            note: t('internalNote'),
            send: t('send'),
            noteSaved: t('noteSaved'),
          }} />
        ) : (
          <div className="empty-state">
            <p>{t('empty')}</p>
          </div>
        )}
      </section>
    </div>
    </>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatusChip({ status, label }: { status: string; label: string }) {
  return <span className={`chip chip-${status}`}>{label}</span>;
}

function ThreadPanel({ conversationId, labels }: { conversationId: string; labels: Record<string, string> }) {
  const t = useTranslations('inbox');
  const [data, setData] = useState<{
    conversation: { subject: string; status: string };
    messages: { id: string; direction: string; authorType: string; authorName: string | null; body: string; sentAt: string }[];
    comments: { id: string; body: string; user: { name: string | null; email: string }; createdAt: string }[];
  } | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/proxy/conversations/${conversationId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((res) => alive && setData(res.data))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [conversationId]);

  async function addNote() {
    if (!note.trim()) return;
    const res = await fetch(`/api/proxy/conversations/${conversationId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: note }),
    });
    if (res.ok) {
      setNote('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  }

  if (!data) return <p className="skeleton-row">…</p>;

  return (
    <div className="thread">
      <h2>{data.conversation.subject}</h2>
      <div className="thread-messages">
        {data.messages.map((m) => (
          <article key={m.id} className={`bubble bubble-${m.direction}`}>
            <header>
              {m.authorName ?? m.authorType} · {new Date(m.sentAt).toLocaleString()}
            </header>
            <p>{m.body}</p>
          </article>
        ))}
      </div>
      <div className="composer">
        <label>
          <span>{labels.reply}</span>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} />
        </label>
        <label>
          <span>{labels.note}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        <button type="button" className="btn-secondary" onClick={addNote}>{labels.send}</button>
        {saved && <span role="status">{labels.noteSaved}</span>}
      </div>
    </div>
  );
}

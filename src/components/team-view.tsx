'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LoadError, Loading, Flash, useFlash } from './workspace-page';

type TeamUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'agent';
  locale: string;
  emailVerified: boolean;
  createdAt: string;
  deactivatedAt: string | null;
};

const api = {
  async list(): Promise<TeamUser[]> {
    const r = await fetch('/api/proxy/users');
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).data ?? [];
  },
  async invite(payload: { email: string; role: string; locale: string; name?: string }) {
    const r = await fetch('/api/proxy/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.code ?? String(r.status));
    return body.data as { id: string; setupToken?: string };
  },
  async patch(id: string, data: { role?: string; locale?: string; name?: string | null }) {
    const r = await fetch(`/api/proxy/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(String(r.status));
  },
  async deactivate(id: string) {
    const r = await fetch(`/api/proxy/users/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(String(r.status));
  },
};

export function TeamView() {
  const t = useTranslations('team');
  const tStates = useTranslations('states');
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const [inviteToken, setInviteToken] = useState<{ token: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // invite form
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('agent');
  const [locale, setLocale] = useState<'en' | 'pl'>('en');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setUsers(null);
    api
      .list()
      .then(setUsers)
      .catch(() => setError('load'));
  }, []);

  useEffect(load, [load]);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    try {
      const created = await api.invite({
        email: email.trim(),
        role,
        locale,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setEmail('');
      setName('');
      if (created.setupToken) {
        const link = `${window.location.origin}/accept-invite?token=${created.setupToken}`;
        setInviteToken({ token: created.setupToken, link });
      }
      load();
    } catch (err) {
      setError(String((err as Error).message ?? 'invite'));
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(u: TeamUser, newRole: string) {
    try {
      await api.patch(u.id, { role: newRole });
      load();
    } catch {
      setError('patch');
    }
  }

  async function changeLocale(u: TeamUser, newLocale: string) {
    try {
      await api.patch(u.id, { locale: newLocale });
      load();
    } catch {
      setError('patch');
    }
  }

  async function deactivate(u: TeamUser) {
    try {
      await api.deactivate(u.id);
      setConfirmId(null);
      load();
    } catch {
      setError('delete');
    }
  }

  return (
    <div className="team">
      <form className="team-invite auth-card" onSubmit={submitInvite}>
        <h2>{t('invite')}</h2>
        <label>
          <span>{t('email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
          />
        </label>
        <label>
          <span>{t('nameOptional')}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <div className="team-invite-row">
          <label>
            <span>{t('role')}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'agent')}>
              <option value="agent">{t('roleAgent')}</option>
              <option value="admin">{t('roleAdmin')}</option>
            </select>
          </label>
          <label>
            <span>{t('language')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as 'en' | 'pl')}>
              <option value="en">English</option>
              <option value="pl">Polski</option>
            </select>
          </label>
          <button type="submit" className="btn-primary" disabled={inviting}>
            {t('inviteCta')}
          </button>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error === 'EMAIL_TAKEN'
              ? t('errorEmailTaken')
              : error === 'VALIDATION_ERROR'
                ? t('errorValidation')
                : t('errorGeneric')}
          </p>
        )}
      </form>

      {inviteToken && (
        <div className="team-invite-token auth-card">
          <p role="status">
            <strong>{t('inviteCreated')}</strong>
          </p>
          <label>
            <span>{t('inviteLink')}</span>
            <input readOnly value={inviteToken.link} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteToken.link);
              } catch {
                /* clipboard may be blocked — the link stays selectable */
              }
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? t('copied') : t('copy')}
          </button>
        </div>
      )}

      {error === 'load' && <LoadError retry={load} />}
      {error === null && users === null && <Loading />}
      {!error && users !== null && users.length === 0 && (
        <div className="empty-state">
          <p>{t('empty')}</p>
        </div>
      )}

      {users !== null && users.length > 0 && (
        <table className="admin-table team-table">
          <thead>
            <tr>
              <th>{t('members')}</th>
              <th>{t('role')}</th>
              <th>{t('language')}</th>
              <th>{t('joined')}</th>
              <th>{t('status')}</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.deactivatedAt ? 'team-row-off' : undefined}>
                <td>
                  <strong>{u.name ?? '—'}</strong>
                  <br />
                  <small>{u.email}</small>
                </td>
                <td>
                  {u.role === 'owner' ? (
                    t(`roleOwner` as 'roleOwner')
                  ) : (
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                      <option value="admin">{t('roleAdmin')}</option>
                      <option value="agent">{t('roleAgent')}</option>
                    </select>
                  )}
                </td>
                <td>
                  <select value={u.locale} onChange={(e) => changeLocale(u, e.target.value)}>
                    <option value="en">EN</option>
                    <option value="pl">PL</option>
                  </select>
                </td>
                <td>
                  <small>{new Date(u.createdAt).toLocaleDateString()}</small>
                </td>
                <td>
                  {u.deactivatedAt ? (
                    <span className="chip chip-pending">{t('deactivated')}</span>
                  ) : (
                    <span className={`chip ${u.emailVerified ? 'chip-resolved' : 'chip-open'}`}>
                      {u.emailVerified ? t('verified') : t('unverified')}
                    </span>
                  )}
                </td>
                <td>
                  {!u.deactivatedAt &&
                    u.role !== 'owner' &&
                    (confirmId === u.id ? (
                      <span className="team-confirm">
                        <span>{t('confirmDeactivate')}</span>
                        <button type="button" className="btn-primary" onClick={() => deactivate(u)}>
                          {t('deactivate')}
                        </button>
                        <button type="button" className="btn-secondary" onClick={() => setConfirmId(null)}>
                          {t('cancel')}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn-secondary" onClick={() => setConfirmId(u.id)}>
                        {t('deactivate')}
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Flash msg={flash} />
      <span hidden>{tStates('empty')}</span>
    </div>
  );
}

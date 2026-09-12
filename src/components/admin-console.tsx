'use client';

import { useEffect, useState } from 'react';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  suspended: boolean;
  createdAt: string;
  users: number;
  conversations: number;
}

interface AdminUser {
  id: string;
  email: string;
  role: string;
  tenant: { name: string; slug: string };
}

interface AiSettings {
  model?: string;
  enabled?: boolean;
  provider?: string;
}

type Labels = Record<string, string>;

export function AdminConsole({
  adminEmail,
  locale,
  chrome,
  labels,
}: {
  adminEmail: string;
  locale: string;
  chrome: React.ReactNode;
  labels: Labels;
}) {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [settings, setSettings] = useState<AiSettings>({});
  const [q, setQ] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    load(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load(query: string) {
    fetch(`/api/proxy/admin/tenants${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setTenants(d.data ?? []))
      .catch(() => setTenants([]));
    fetch('/api/proxy/admin/users')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setUsers(d.data ?? []))
      .catch(() => setUsers([]));
    fetch('/api/proxy/admin/settings')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setSettings(d.data ?? {}))
      .catch(() => setSettings({}));
  }

  async function toggleSuspend(t: Tenant) {
    await fetch(`/api/proxy/admin/tenants/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ suspended: !t.suspended }),
    });
    load(q);
  }

  async function saveSettings() {
    const res = await fetch('/api/proxy/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 3000);
    }
  }

  return (
    <div className="admin">
      <header className="admin-topbar">
        <h1>{labels.title}</h1>
        <span>{adminEmail}</span>
        {chrome}
        <a href="/sign-in-please" hidden />
      </header>

      <section aria-label={labels.tenants}>
        <h2>{labels.tenants}</h2>
        <input
          type="search"
          placeholder={labels.searchPlaceholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            load(e.target.value);
          }}
        />
        <table className="admin-table">
          <thead>
            <tr>
              <th>{labels.tenants}</th>
              <th>{labels.plan}</th>
              <th>{labels.status}</th>
              <th>{labels.members}</th>
              <th>{labels.conversations}</th>
              <th>{labels.created}</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong> <small>/{t.slug}</small>
                </td>
                <td>{t.plan}</td>
                <td>
                  <span className={`chip ${t.suspended ? 'chip-pending' : 'chip-resolved'}`}>
                    {t.suspended ? labels.suspended : labels.active}
                  </span>
                </td>
                <td>{t.users}</td>
                <td>{t.conversations}</td>
                <td>{new Date(t.createdAt).toLocaleDateString(locale)}</td>
                <td>
                  <button type="button" className="btn-secondary" onClick={() => toggleSuspend(t)}>
                    {t.suspended ? labels.activate : labels.suspend}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tenants !== null && tenants.length === 0 && <p className="empty-state">{labels.searchPlaceholder}</p>}
      </section>

      <section aria-label={labels.users}>
        <h2>{labels.users}</h2>
        <ul className="admin-users">
          {(users ?? []).map((u) => (
            <li key={u.id}>
              <span>{u.email}</span>
              <span className="chip chip-open">{u.role}</span>
              <small>{u.tenant?.name}</small>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={labels.settings}>
        <h2>{labels.settings}</h2>
        <label>
          <span>{labels.aiModel}</span>
          <input
            type="text"
            value={settings.model ?? ''}
            onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
          />
        </label>
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={settings.enabled ?? false}
            onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
          />
          <span>{labels.aiEnabled}</span>
        </label>
        <button type="button" className="btn-primary" onClick={saveSettings}>
          {labels.save}
        </button>
        {savedFlash && <span role="status">{labels.saved}</span>}
      </section>
    </div>
  );
}

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  tenant: { name: string; slug: string } | null;
}

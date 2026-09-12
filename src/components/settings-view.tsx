'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LanguageToggle } from './auth-chrome';

type Role = 'owner' | 'admin' | 'agent';

export function SettingsView({
  user,
  tenant,
  locale,
  chrome,
}: {
  user: { email: string; name: string | null; role: Role };
  tenant: string;
  locale: string;
  chrome: React.ReactNode;
}) {
  const t = useTranslations('settings');
  const [name, setName] = useState(user.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/proxy/users/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || null }),
      });
      if (r.status === 400) {
        setError('validation');
        return;
      }
      if (!r.ok) {
        setError('generic');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('generic');
    } finally {
      setSaving(false);
    }
  }

  const roleKey = (`role${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`) as
    | 'roleOwner'
    | 'roleAdmin'
    | 'roleAgent';

  return (
    <div className="settings">
      <form className="auth-card settings-card" onSubmit={save}>
        <h2>{t('profile')}</h2>
        <label>
          <span>{t('name')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoComplete="name"
          />
        </label>
        <label>
          <span>{t('email')}</span>
          <input type="email" value={user.email} readOnly disabled />
        </label>
        <label>
          <span>{t('role')}</span>
          <input type="text" value={t(roleKey)} readOnly disabled />
        </label>
        <label>
          <span>{t('workspace')}</span>
          <input type="text" value={tenant} readOnly disabled />
        </label>
        <div className="kb-form-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {t('save')}
          </button>
          {saved && (
            <span role="status" className="chip chip-resolved">
              {t('saved')}
            </span>
          )}
          {error && (
            <span role="alert" className="chip chip-pending">
              {t(error === 'validation' ? 'errorValidation' : 'errorGeneric')}
            </span>
          )}
        </div>
      </form>

      <div className="auth-card settings-card">
        <h2>{t('language')}</h2>
        <p className="settings-note">{t('languageHint')}</p>
        {chrome ?? <LanguageToggle current={locale} />}
      </div>
    </div>
  );
}

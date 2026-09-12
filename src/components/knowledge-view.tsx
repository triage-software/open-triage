'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LoadError, Loading, Flash, useFlash } from './workspace-page';

type Item = {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type Detail = Item & { content: string };

const api = {
  async list(): Promise<Item[]> {
    const r = await fetch('/api/proxy/knowledge-items');
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).data ?? [];
  },
  async get(id: string): Promise<Detail> {
    const r = await fetch(`/api/proxy/knowledge-items/${id}`);
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).data;
  },
  async create(title: string, content: string): Promise<Detail> {
    const r = await fetch('/api/proxy/knowledge-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).data;
  },
  async update(id: string, patch: { title?: string; content?: string }): Promise<Detail> {
    const r = await fetch(`/api/proxy/knowledge-items/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).data;
  },
  async remove(id: string): Promise<void> {
    const r = await fetch(`/api/proxy/knowledge-items/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(String(r.status));
  },
};

export function KnowledgeView({ canManage }: { canManage: boolean }) {
  const t = useTranslations('knowledge');
  const tStates = useTranslations('states');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const [flash, setFlash] = useFlash();

  const [editing, setEditing] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    setItems(null);
    api
      .list()
      .then(setItems)
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  function startCreate() {
    setEditing(null);
    setCreating(true);
    setTitle('');
    setContent('');
  }

  async function startEdit(id: string) {
    try {
      const d = await api.get(id);
      setCreating(false);
      setEditing(d);
      setTitle(d.title);
      setContent(d.content);
    } catch {
      setError(true);
    }
  }

  function cancel() {
    setCreating(false);
    setEditing(null);
    setTitle('');
    setContent('');
    setConfirmId(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    try {
      if (editing) {
        await api.update(editing.id, { title: title.trim(), content: content.trim() });
        setFlash(t('updatedDone'));
      } else {
        await api.create(title.trim(), content.trim());
        setFlash(t('created'));
      }
      cancel();
      load();
    } catch {
      setError(true);
    }
  }

  async function remove(id: string) {
    try {
      await api.remove(id);
      setFlash(t('deleted'));
      setConfirmId(null);
      load();
    } catch {
      setError(true);
    }
  }

  return (
    <div className="kb">
      <div className="kb-toolbar">
        <Flash msg={flash} />
        {canManage ? (
          <button type="button" className="btn-primary" onClick={startCreate}>
            {t('new')}
          </button>
        ) : (
          <span className="chip chip-pending">{t('readonly')}</span>
        )}
      </div>

      {error && <LoadError retry={load} />}
      {!error && items === null && <Loading />}
      {!error && items !== null && items.length === 0 && (
        <div className="empty-state">
          <p>{t('empty')}</p>
          <small>{t('emptyCta')}</small>
        </div>
      )}

      {(creating || editing) && (
        <form className="kb-form auth-card" onSubmit={save}>
          <label>
            <span>{t('titleField')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
          </label>
          <label>
            <span>{t('contentField')}</span>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} required />
          </label>
          <div className="kb-form-actions">
            <button type="submit" className="btn-primary">
              {t('save')}
            </button>
            <button type="button" className="btn-secondary" onClick={cancel}>
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {!error && items !== null && items.length > 0 && (
        <ul className="kb-list" role="list">
          {items.map((it) => (
            <li key={it.id} className="kb-row">
              <div className="kb-row-main">
                <strong>{it.title}</strong>
                <small>
                  {t('updated')} {new Date(it.updatedAt).toLocaleString()} · {it.source}
                </small>
              </div>
              {canManage && (
                <div className="kb-row-actions">
                  <button type="button" className="btn-secondary" onClick={() => startEdit(it.id)}>
                    {t('edit')}
                  </button>
                  {confirmId === it.id ? (
                    <>
                      <button type="button" className="btn-primary" onClick={() => remove(it.id)}>
                        {t('delete')}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setConfirmId(null)}>
                        {t('cancel')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn-secondary" onClick={() => setConfirmId(it.id)}>
                      {t('delete')}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <span hidden>{tStates('empty')}</span>
    </div>
  );
}

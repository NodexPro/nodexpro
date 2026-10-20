import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import './owner-modules/nx-owner-modules.css';

type LanguageRow = { locale_code?: string; name?: string; direction?: string; status?: string; version?: number };
type TranslationEntry = {
  key?: string;
  module_group?: string;
  source_en?: string;
  value?: string;
  status?: string;
  placeholder_ok?: boolean;
};

type LanguagesAggregate = {
  languages?: LanguageRow[];
  selected_locale?: string;
  workspace?: {
    completeness?: { ratio?: number; complete?: boolean };
    placeholder_failures?: number;
    catalog_size?: number;
    translated_count?: number;
    uncovered_application_areas?: string[];
    entries?: TranslationEntry[];
    groups?: string[];
    language?: LanguageRow;
  };
  ai_translation?: { available?: boolean; note?: string };
};

export function PlatformOwnerLanguagesPage() {
  const [aggregate, setAggregate] = useState<LanguagesAggregate | null>(null);
  const [locale, setLocale] = useState('en');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newLang, setNewLang] = useState({ locale_code: '', name: '', direction: 'ltr' });

  const load = useCallback(async (nextLocale?: string) => {
    setError('');
    try {
      const selected = nextLocale ?? locale;
      const data = await apiJson<LanguagesAggregate>(`${OWNER.languages}?locale=${encodeURIComponent(selected)}`);
      setAggregate(data);
      setLocale(String(data.selected_locale ?? selected));
      const nextDrafts: Record<string, string> = {};
      for (const entry of data.workspace?.entries ?? []) {
        if (entry.key) nextDrafts[entry.key] = entry.value ?? '';
      }
      setDrafts(nextDrafts);
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  }, [locale]);

  useEffect(() => {
    void load('en');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(command: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const out = (await apiJson(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({ command, payload }),
      })) as { refreshed?: { aggregate?: LanguagesAggregate } };
      if (out.refreshed?.aggregate) {
        setAggregate(out.refreshed.aggregate);
        const selected = String(out.refreshed.aggregate.selected_locale ?? locale);
        setLocale(selected);
        const nextDrafts: Record<string, string> = {};
        for (const entry of out.refreshed.aggregate.workspace?.entries ?? []) {
          if (entry.key) nextDrafts[entry.key] = entry.value ?? '';
        }
        setDrafts(nextDrafts);
      } else {
        await load(locale);
      }
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (aggregate?.workspace?.entries ?? []).filter((entry) => {
      if (!q) return true;
      return `${entry.key} ${entry.source_en} ${entry.value}`.toLowerCase().includes(q);
    });
  }, [aggregate, search]);

  return (
    <div className="nx-owner-modules">
      <h1 className="nx-owner-modules__title">Languages & Translations</h1>
      <p className="nx-owner-modules__subtitle">
        Manual translation catalog. Completeness is measured against the canonical settings/account keys, not the entire
        application. AI generation is not available.
      </p>
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(aggregate?.languages ?? []).map((language) => (
          <button
            key={String(language.locale_code)}
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            onClick={() => void load(String(language.locale_code))}
          >
            {language.name} ({language.locale_code}) · {language.status}
          </button>
        ))}
      </div>
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void run('create_platform_language', newLang);
        }}
      >
        <input
          placeholder="es"
          value={newLang.locale_code}
          onChange={(e) => setNewLang((f) => ({ ...f, locale_code: e.target.value }))}
        />
        <input
          placeholder="Español"
          value={newLang.name}
          onChange={(e) => setNewLang((f) => ({ ...f, name: e.target.value }))}
        />
        <select
          value={newLang.direction}
          onChange={(e) => setNewLang((f) => ({ ...f, direction: e.target.value }))}
        >
          <option value="ltr">LTR</option>
          <option value="rtl">RTL</option>
        </select>
        <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
          Add language
        </button>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy}
          onClick={() => void run('sync_platform_translation_catalog', { locale_code: locale })}
        >
          Sync catalog
        </button>
      </form>
      <p>
        Completeness: {Math.round(Number(aggregate?.workspace?.completeness?.ratio ?? 0) * 100)}% · placeholders failed:{' '}
        {aggregate?.workspace?.placeholder_failures ?? 0}
      </p>
      <p style={{ color: '#6b7280', fontSize: 13 }}>{aggregate?.ai_translation?.note}</p>
      <input
        placeholder="Search key or source text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12, width: 'min(420px, 100%)' }}
      />
      <div style={{ overflowX: 'auto', maxHeight: 480 }}>
        <table className="nx-owner-sheet">
          <thead>
            <tr>
              <th>Group</th>
              <th>Key</th>
              <th>English</th>
              <th>Translation</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={String(entry.key)}>
                <td>{entry.module_group}</td>
                <td>
                  <code>{entry.key}</code>
                </td>
                <td>{entry.source_en}</td>
                <td>
                  <input
                    value={drafts[String(entry.key)] ?? ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [String(entry.key)]: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy}
          onClick={() =>
            void run('save_platform_translation_draft', {
              locale_code: locale,
              entries: Object.entries(drafts).map(([key, value]) => ({ key, value })),
            })
          }
        >
          Save draft
        </button>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy}
          onClick={() => void run('publish_platform_language', { locale_code: locale })}
        >
          Publish language
        </button>
      </div>
      <h3>Uncovered application areas</h3>
      <ul>
        {(aggregate?.workspace?.uncovered_application_areas ?? []).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

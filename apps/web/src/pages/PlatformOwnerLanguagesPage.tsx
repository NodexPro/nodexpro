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
  filter_status?: string;
  placeholder_ok?: boolean;
};
type ModuleCompleteness = {
  module_group?: string;
  catalog_size?: number;
  translated_count?: number;
  missing_count?: number;
  ratio?: number;
};
type LanguageVersion = {
  version?: number;
  status?: string;
  completeness_ratio?: number;
  published_at?: string | null;
  has_snapshot?: boolean;
};

type LanguagesAggregate = {
  languages?: LanguageRow[];
  selected_locale?: string;
  workspace?: {
    completeness?: { ratio?: number; complete?: boolean };
    module_completeness?: ModuleCompleteness[];
    placeholder_failures?: number;
    catalog_size?: number;
    translated_count?: number;
    uncovered_application_areas?: string[];
    entries?: TranslationEntry[];
    groups?: string[];
    language?: LanguageRow;
    versions?: LanguageVersion[];
  };
  ai_translation?: { available?: boolean; note?: string };
  allowed_actions?: string[];
};

export function PlatformOwnerLanguagesPage() {
  const [aggregate, setAggregate] = useState<LanguagesAggregate | null>(null);
  const [locale, setLocale] = useState('en');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'draft' | 'published'>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [newLang, setNewLang] = useState({ locale_code: '', name: '', direction: 'ltr' });

  const applyAggregate = (data: LanguagesAggregate, fallbackLocale: string) => {
    setAggregate(data);
    setLocale(String(data.selected_locale ?? fallbackLocale));
    const nextDrafts: Record<string, string> = {};
    for (const entry of data.workspace?.entries ?? []) {
      if (entry.key) nextDrafts[entry.key] = entry.value ?? '';
    }
    setDrafts(nextDrafts);
    setBaseline(nextDrafts);
  };

  const load = useCallback(async (nextLocale?: string) => {
    setError('');
    try {
      const selected = nextLocale ?? locale;
      const data = await apiJson<LanguagesAggregate>(`${OWNER.languages}?locale=${encodeURIComponent(selected)}`);
      applyAggregate(data, selected);
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
        applyAggregate(out.refreshed.aggregate, locale);
      } else {
        await load(locale);
      }
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const dirtyEntries = useMemo(
    () =>
      Object.entries(drafts)
        .filter(([key, value]) => value !== (baseline[key] ?? ''))
        .map(([key, value]) => ({ key, value })),
    [drafts, baseline],
  );

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (aggregate?.workspace?.entries ?? []).filter((entry) => {
      if (groupFilter !== 'all' && entry.module_group !== groupFilter) return false;
      const status = entry.filter_status ?? (entry.status === 'published' ? 'published' : entry.value?.trim() ? 'draft' : 'missing');
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!q) return true;
      return `${entry.key} ${entry.source_en} ${entry.value}`.toLowerCase().includes(q);
    });
  }, [aggregate, search, groupFilter, statusFilter]);

  const catalogSize = Number(aggregate?.workspace?.catalog_size ?? 0);
  const moduleRows = aggregate?.workspace?.module_completeness ?? [];
  const versions = aggregate?.workspace?.versions ?? [];
  const groups = aggregate?.workspace?.groups ?? [];

  return (
    <div className="nx-owner-modules">
      <h1 className="nx-owner-modules__title">Languages & Translations</h1>
      <p className="nx-owner-modules__subtitle">
        Platform UI catalog. Completeness is measured against every registered NodexPro UI key.
        Client names, documents, legal values, and user data are not translated. AI generation is not available.
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
        Completeness: {Math.round(Number(aggregate?.workspace?.completeness?.ratio ?? 0) * 100)}% · {aggregate?.workspace?.translated_count ?? 0}/{catalogSize} keys · placeholders failed:{' '}
        {aggregate?.workspace?.placeholder_failures ?? 0}
      </p>
      <p style={{ color: '#6b7280', fontSize: 13 }}>{aggregate?.ai_translation?.note}</p>
      <h3>Completeness by module</h3>
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table className="nx-owner-sheet">
          <thead>
            <tr>
              <th>Module</th>
              <th>Translated</th>
              <th>Missing</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {moduleRows.map((row) => (
              <tr key={String(row.module_group)}>
                <td>{row.module_group}</td>
                <td>
                  {row.translated_count}/{row.catalog_size}
                </td>
                <td>{row.missing_count}</td>
                <td>{Math.round(Number(row.ratio ?? 0) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          placeholder="Search key or source text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 'min(420px, 100%)' }}
        />
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filter by module">
          <option value="all">All modules</option>
          {groups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="missing">Missing</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 480 }}>
        <table className="nx-owner-sheet">
          <thead>
            <tr>
              <th>Group</th>
              <th>Key</th>
              <th>Status</th>
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
                <td>{entry.filter_status ?? entry.status}</td>
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
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || dirtyEntries.length === 0}
          onClick={() =>
            void run('save_platform_translation_draft', {
              locale_code: locale,
              entries: dirtyEntries,
            })
          }
        >
          Save draft{dirtyEntries.length ? ` (${dirtyEntries.length})` : ''}
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
      <h3>Published versions</h3>
      <ul>
        {versions.length === 0 ? <li>No published snapshots yet.</li> : null}
        {versions.map((version) => (
          <li key={String(version.version)} style={{ marginBottom: 8 }}>
            v{version.version} · {version.status} · {Math.round(Number(version.completeness_ratio ?? 0) * 100)}%
            {version.has_snapshot ? (
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                style={{ marginInlineStart: 8 }}
                disabled={busy}
                onClick={() =>
                  void run('rollback_platform_language', { locale_code: locale, version: version.version })
                }
              >
                Rollback to v{version.version}
              </button>
            ) : (
              <span style={{ marginInlineStart: 8, color: '#6b7280' }}>no snapshot</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

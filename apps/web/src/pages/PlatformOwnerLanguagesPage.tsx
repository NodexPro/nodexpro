import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiJson } from '../api/client';
import { OWNER } from '../api/endpoints';
import { invalidatePublishedTranslationOverlay } from '../i18n/I18nProvider';
import './owner-modules/nx-owner-modules.css';

type LanguageRow = { locale_code?: string; name?: string; direction?: string; status?: string; version?: number };
type TranslationEntry = {
  key?: string;
  module_group?: string;
  source_en?: string;
  value?: string;
  bundled_value?: string;
  live_value?: string;
  value_origin?: string;
  empty_explanation?: string | null;
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
type IssueCard = {
  id?: string;
  kind?: string;
  tab?: string;
  location?: string;
  localization_key?: string | null;
  current_displayed_text?: string;
  source_language?: string;
  target_language?: string;
  published_value?: string | null;
  bundled_value?: string | null;
  draft_value?: string | null;
  value_origin?: string;
  empty_explanation?: string | null;
  reason?: string;
  requires_code_fix?: boolean;
  usage_locations?: Array<{ tab?: string; location?: string }>;
  placeholder_ok?: boolean;
  editable?: boolean;
};
type LocalizationAudit = {
  selected_module?: string;
  selected_locale?: string;
  target_direction?: string;
  catalog_size?: number;
  live_translated_count?: number;
  owner_override_count?: number;
  bundled_only_count?: number;
  empty_live_count?: number;
  confirmed_issue_count?: number;
  by_kind?: Record<string, number>;
  tabs?: string[];
  issues?: IssueCard[];
  unverified_surfaces?: Array<{ tab?: string; reason?: string }>;
};
type LanguagesAggregate = {
  languages?: LanguageRow[];
  selected_locale?: string;
  selected_module?: string;
  workspace?: {
    completeness?: { ratio?: number; complete?: boolean };
    module_completeness?: ModuleCompleteness[];
    placeholder_failures?: number;
    catalog_size?: number;
    translated_count?: number;
    owner_override_count?: number;
    uncovered_application_areas?: string[];
    entries?: TranslationEntry[];
    groups?: string[];
    language?: LanguageRow;
    versions?: LanguageVersion[];
    localization_audit?: LocalizationAudit;
  };
  ai_translation?: { available?: boolean; note?: string };
  allowed_actions?: string[];
};

function ownerLanguagesLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Sign in as platform owner. Privileged MFA may be required.';
    }
    if (error.status === 403) {
      return 'Platform owner access cannot run inside an office tenant session. Open Owner login without an organization context.';
    }
    const message = (error.message ?? '').trim();
    if (message) return message;
  }
  if (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message)) {
    return 'Network error while loading the language catalog. Try again.';
  }
  return 'The language catalog could not be loaded.';
}

function emptyExplanationLabel(code: string | null | undefined): string {
  if (code === 'no_owner_override') return 'No Owner override — bundled translation is used live.';
  if (code === 'no_bundled_translation') return 'No bundled translation and no Owner override.';
  if (code === 'placeholder_mismatch') return 'Owner value exists, but placeholders do not match English.';
  return 'Value is present.';
}

function originLabel(origin: string | undefined): string {
  if (origin === 'owner_published') return 'Owner published';
  if (origin === 'owner_draft') return 'Owner draft';
  if (origin === 'bundled') return 'Bundled dictionary';
  if (origin === 'hardcoded') return 'Hardcoded / unconnected';
  return 'Empty';
}

function kindLabel(kind: string | undefined): string {
  if (kind === 'missing_translation') return 'Missing translation';
  if (kind === 'wrong_language_system_text') return 'Wrong-language system text';
  if (kind === 'hardcoded_unconnected') return 'Hardcoded / unconnected';
  if (kind === 'direction_issue') return 'Direction issue';
  if (kind === 'placeholder_mismatch') return 'Placeholder mismatch';
  if (kind === 'needs_review') return 'Needs review';
  return kind ?? 'Issue';
}

export function PlatformOwnerLanguagesPage() {
  const [aggregate, setAggregate] = useState<LanguagesAggregate | null>(null);
  const [locale, setLocale] = useState('en');
  const [moduleGroup, setModuleGroup] = useState('clientOperations');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'bundled' | 'draft' | 'published' | 'missing'>('all');
  const [view, setView] = useState<'issues' | 'catalog'>('issues');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [newLang, setNewLang] = useState({ locale_code: '', name: '', direction: 'ltr' });
  const [tabFilter, setTabFilter] = useState('all');

  const applyAggregate = (data: LanguagesAggregate, fallbackLocale: string, fallbackModule: string) => {
    setAggregate(data);
    setLocale(String(data.selected_locale ?? fallbackLocale));
    setModuleGroup(String(data.selected_module ?? fallbackModule));
    const nextDrafts: Record<string, string> = {};
    for (const entry of data.workspace?.entries ?? []) {
      if (entry.key) nextDrafts[entry.key] = entry.value ?? '';
    }
    setDrafts(nextDrafts);
    setBaseline(nextDrafts);
  };

  const load = useCallback(async (nextLocale?: string, nextModule?: string) => {
    setError('');
    setLoading(true);
    try {
      const selected = nextLocale ?? locale;
      const selectedModule = nextModule ?? moduleGroup;
      const data = await apiJson<LanguagesAggregate>(
        `${OWNER.languages}?locale=${encodeURIComponent(selected)}&module=${encodeURIComponent(selectedModule)}`,
      );
      applyAggregate(data, selected, selectedModule);
    } catch (e) {
      setError(ownerLanguagesLoadError(e));
    } finally {
      setLoading(false);
    }
  }, [locale, moduleGroup]);

  useEffect(() => {
    void load('en', 'clientOperations');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(command: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const out = (await apiJson(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({ command, payload: { ...payload, module_group: moduleGroup } }),
      })) as { refreshed?: { aggregate?: LanguagesAggregate } };
      if (command === 'publish_platform_language' || command === 'rollback_platform_language') {
        invalidatePublishedTranslationOverlay();
      }
      if (out.refreshed?.aggregate) {
        applyAggregate(out.refreshed.aggregate, locale, moduleGroup);
      } else {
        await load(locale, moduleGroup);
      }
    } catch (e) {
      setError(ownerLanguagesLoadError(e));
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
      if (moduleGroup !== 'all' && entry.module_group !== moduleGroup) return false;
      const status = entry.filter_status ?? (entry.status === 'published' ? 'published' : entry.value?.trim() ? 'draft' : 'missing');
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!q) return true;
      return `${entry.key} ${entry.source_en} ${entry.value} ${entry.live_value} ${entry.bundled_value}`.toLowerCase().includes(q);
    });
  }, [aggregate, search, moduleGroup, statusFilter]);

  const audit = aggregate?.workspace?.localization_audit;
  const issues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (audit?.issues ?? []).filter((issue) => {
      if (tabFilter !== 'all' && issue.tab !== tabFilter) return false;
      if (!q) return true;
      return `${issue.tab} ${issue.location} ${issue.localization_key} ${issue.current_displayed_text} ${issue.reason}`
        .toLowerCase()
        .includes(q);
    });
  }, [audit, search, tabFilter]);

  const catalogSize = Number(aggregate?.workspace?.catalog_size ?? 0);
  const moduleRows = aggregate?.workspace?.module_completeness ?? [];
  const versions = aggregate?.workspace?.versions ?? [];
  const groups = aggregate?.workspace?.groups ?? [];
  const editorDir = aggregate?.workspace?.language?.direction === 'rtl' ? 'rtl' : 'ltr';
  const sourceDir = 'ltr';

  return (
    <div className="nx-owner-modules">
      <h1 className="nx-owner-modules__title">Languages & Translations</h1>
      <p className="nx-owner-modules__subtitle">
        Localization control center. Confirmed Client Operations system-label issues can be edited, drafted, and
        published without a deploy. Client names, documents, legal values, and user data are not translated. AI generation is not available.
        Empty catalog fields mean no Owner override — bundled text still shows live. Missing means no live translation (no bundled value and no Owner override). Draft is saved but not live; Publish replaces the live overlay. Red cards are confirmed problems, not merely a missing Owner override. Hardcoded chrome requires a code fix.
      </p>
      {error ? <p className="nx-owner-languages-error">{error}</p> : null}
      {loading ? <p>Loading language catalog…</p> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(aggregate?.languages ?? []).map((language) => (
          <button
            key={String(language.locale_code)}
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || loading}
            onClick={() => void load(String(language.locale_code), moduleGroup)}
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
        Live coverage: {Math.round(Number(aggregate?.workspace?.completeness?.ratio ?? 0) * 100)}% ·{' '}
        {aggregate?.workspace?.translated_count ?? 0}/{catalogSize} keys live · Owner overrides:{' '}
        {aggregate?.workspace?.owner_override_count ?? 0} · placeholders failed:{' '}
        {aggregate?.workspace?.placeholder_failures ?? 0}
      </p>
      <p style={{ color: '#6b7280', fontSize: 13 }}>{aggregate?.ai_translation?.note}</p>
      <h3>Completeness by module</h3>
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table className="nx-owner-sheet">
          <thead>
            <tr>
              <th>Module</th>
              <th>Live</th>
              <th>Empty live</th>
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
      <div className="nx-owner-tabs" role="tablist" aria-label="Owner languages views">
        <button type="button" className={view === 'issues' ? 'is-active' : ''} onClick={() => setView('issues')}>
          Localization issues
        </button>
        <button type="button" className={view === 'catalog' ? 'is-active' : ''} onClick={() => setView('catalog')}>
          Catalog
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          placeholder="Search key or source text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 'min(420px, 100%)' }}
          dir={editorDir}
        />
        <select
          value={moduleGroup}
          onChange={(e) => {
            const next = e.target.value;
            setModuleGroup(next);
            void load(locale, next);
          }}
          aria-label="Filter by module"
        >
          {groups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
        {view === 'catalog' ? (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="missing">No live translation</option>
            <option value="bundled">Bundled only (no Owner override)</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        ) : (
          <select value={tabFilter} onChange={(e) => setTabFilter(e.target.value)} aria-label="Filter issues by tab">
            <option value="all">All tabs</option>
            {(audit?.tabs ?? []).map((tab) => (
              <option key={tab} value={tab}>
                {tab}
              </option>
            ))}
          </select>
        )}
      </div>

      {view === 'issues' ? (
        <div className="nx-owner-issue-list">
          <p>
            {moduleGroup} / {locale}: {audit?.confirmed_issue_count ?? 0} confirmed issues · live{' '}
            {audit?.live_translated_count ?? 0}/{audit?.catalog_size ?? 0} · Owner overrides {audit?.owner_override_count ?? 0} ·
            bundled-only {audit?.bundled_only_count ?? 0}
          </p>
          {issues.length === 0 && !loading ? (
            <p>No confirmed localization issues for this module and language.</p>
          ) : null}
          {issues.map((issue) => {
            const key = issue.localization_key ?? '';
            const preview = key ? drafts[key] ?? issue.current_displayed_text ?? '' : issue.current_displayed_text ?? '';
            return (
              <article key={String(issue.id)} className="nx-owner-issue-card">
                <header className="nx-owner-issue-card__header">
                  <strong>{kindLabel(issue.kind)}</strong>
                  <span>
                    {issue.tab} · {issue.location}
                  </span>
                </header>
                {issue.requires_code_fix ? (
                  <p className="nx-owner-issue-card__code-fix">Requires code fix. Editing a translation will not change this hardcoded label.</p>
                ) : null}
                <dl className="nx-owner-issue-card__meta">
                  <div>
                    <dt>Current displayed system text</dt>
                    <dd dir={issue.source_language === 'he' ? 'rtl' : 'ltr'}>{issue.current_displayed_text || '—'}</dd>
                  </div>
                  <div>
                    <dt>Source → target</dt>
                    <dd>
                      {issue.source_language} → {issue.target_language} ({editorDir.toUpperCase()})
                    </dd>
                  </div>
                  <div>
                    <dt>Localization key</dt>
                    <dd>
                      {key ? <code>{key}</code> : 'Not connected'}
                    </dd>
                  </div>
                  <div>
                    <dt>Published / bundled</dt>
                    <dd>
                      {originLabel(issue.value_origin)} · {emptyExplanationLabel(issue.empty_explanation)}
                    </dd>
                  </div>
                </dl>
                <p>{issue.reason}</p>
                {(issue.usage_locations ?? []).length > 1 ? (
                  <p>
                    Shared key used in:{' '}
                    {(issue.usage_locations ?? []).map((row) => `${row.tab} (${row.location})`).join(' · ')}
                  </p>
                ) : null}
                {issue.editable && key ? (
                  <>
                    <label className="nx-owner-issue-card__editor">
                      Correction
                      <textarea
                        dir={editorDir}
                        value={drafts[key] ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                        rows={3}
                      />
                    </label>
                    <p className="nx-owner-issue-card__preview">
                      Preview (draft, not live): <span dir={editorDir}>{preview || '—'}</span>
                    </p>
                  </>
                ) : null}
              </article>
            );
          })}
          {(audit?.unverified_surfaces ?? []).length ? (
            <div className="nx-owner-issue-unverified">
              <h4>Unverified surfaces</h4>
              <ul>
                {(audit?.unverified_surfaces ?? []).map((row) => (
                  <li key={String(row.tab)}>
                    <strong>{row.tab}:</strong> {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
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
                    <div className="nx-owner-issue-card__origin">{emptyExplanationLabel(entry.empty_explanation)}</div>
                  </td>
                  <td>{entry.filter_status ?? entry.status}</td>
                  <td dir={sourceDir}>{entry.source_en}</td>
                  <td>
                    <input
                      dir={editorDir}
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
      )}
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

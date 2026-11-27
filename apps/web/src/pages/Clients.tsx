import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson, apiFetch, userFacingApiMessage } from '../api/client';
import {
  orgClients,
  orgClientsImportPreview,
  orgClientsImportCommand,
  orgClientsExport,
  orgClientsBulkMarkActive,
  orgClientsBulkMarkInactive,
  orgClientsBulkArchive,
  orgClientsBulkRestore,
  orgClientsBulkExport,
} from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { GlassFilePicker } from '../components/glass/GlassFilePicker';
import {
  canonicalCreatedClientId,
  createdClientDestination,
  createdClientOpenLocationState,
} from './client-create-navigation.pure';
import {
  beginExclusiveSubmit,
  buildCreateClientCommandPayload,
  endExclusiveSubmit,
  firstInvalidCreateClientFocusField,
  mapCreateClientCommandError,
  validateCreateClientDraft,
  type CreateClientField,
} from './client-create-form.pure';
import { AccountRequiredMark } from '../components/glass/AccountRequiredMark';
import '../styles/nx-glass-surface.css';
import '../styles/nx-clients.css';
import '../styles/nx-office-deep-ocean.css';
import '../styles/nx-client-create-royal-glass.css';
import '../styles/nx-client-create-navy-royal-glass.css';
import '../styles/nx-client-create-deep-ocean-glass.css';

type CreateClientModalAppearance =
  | 'current'
  | 'royal-glass'
  | 'navy-royal-glass'
  | 'deep-ocean-glass';

/**
 * Create Client modal visual experiment switch (local, not a user setting).
 * current            — original production appearance in nx-clients.css
 * royal-glass        — bright royal-blue glass (nx-client-create--royal-glass)
 * navy-royal-glass   — restrained navy glass (nx-client-create--navy-royal-glass)
 * deep-ocean-glass   — brighter translucent ocean glass (nx-client-create--deep-ocean-glass)
 * Rollback: change this assignment. Do not delete prior modal CSS.
 */
const CREATE_CLIENT_MODAL_APPEARANCE: CreateClientModalAppearance = 'deep-ocean-glass';

function createClientOverlayClass(appearance: CreateClientModalAppearance): string {
  if (appearance === 'royal-glass') {
    return 'nx-clients-overlay nx-client-create nx-client-create--royal-glass';
  }
  if (appearance === 'navy-royal-glass') {
    return 'nx-clients-overlay nx-client-create nx-client-create--navy-royal-glass';
  }
  if (appearance === 'deep-ocean-glass') {
    return 'nx-clients-overlay nx-client-create nx-client-create--deep-ocean-glass';
  }
  return 'nx-clients-overlay nx-client-create';
}

const VIEW_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'clients.views.all' },
  { value: 'active', labelKey: 'clients.views.active' },
  { value: 'inactive', labelKey: 'clients.views.inactive' },
  { value: 'archived', labelKey: 'clients.views.archived' },
  { value: 'business_customer', labelKey: 'clients.views.business_customer' },
  { value: 'individual_customer', labelKey: 'clients.views.individual_customer' },
  { value: 'supplier', labelKey: 'clients.views.supplier' },
  { value: 'partner', labelKey: 'clients.views.partner' },
  { value: 'other', labelKey: 'clients.views.other' },
  { value: 'recently_updated', labelKey: 'clients.views.recently_updated' },
  { value: 'missing_tax_id', labelKey: 'clients.views.missing_tax_id' },
  { value: 'duplicate_candidates', labelKey: 'clients.views.duplicate_candidates' },
];

/** Single sort dropdown: value maps to backend sort_by + sort_dir. */
const SORT_OPTIONS: { value: string; sort_by: string; sort_dir: 'asc' | 'desc'; labelKey: string }[] = [
  { value: 'display_name_asc', sort_by: 'display_name', sort_dir: 'asc', labelKey: 'clients.sort.nameAZ' },
  { value: 'display_name_desc', sort_by: 'display_name', sort_dir: 'desc', labelKey: 'clients.sort.nameZA' },
  { value: 'created_at_desc', sort_by: 'created_at', sort_dir: 'desc', labelKey: 'clients.sort.createdNewest' },
  { value: 'created_at_asc', sort_by: 'created_at', sort_dir: 'asc', labelKey: 'clients.sort.createdOldest' },
  { value: 'updated_at_desc', sort_by: 'updated_at', sort_dir: 'desc', labelKey: 'clients.sort.updatedNewest' },
  { value: 'updated_at_asc', sort_by: 'updated_at', sort_dir: 'asc', labelKey: 'clients.sort.updatedOldest' },
  { value: 'status_asc', sort_by: 'status', sort_dir: 'asc', labelKey: 'clients.sort.status' },
];
const DEFAULT_SORT_OPTION = 'display_name_asc';
function lookupLabel(t: (key: string) => string, key: string, raw: string): string {
  const translated = t(key);
  return translated === key ? raw : translated;
}

function getSortParams(sortOption: string): { sort_by: string; sort_dir: 'asc' | 'desc' } {
  const found = SORT_OPTIONS.find((o) => o.value === sortOption);
  if (found) return { sort_by: found.sort_by, sort_dir: found.sort_dir };
  const def = SORT_OPTIONS.find((o) => o.value === DEFAULT_SORT_OPTION)!;
  return { sort_by: def.sort_by, sort_dir: def.sort_dir };
}

interface ClientRow {
  id: string;
  tax_id?: string;
  client_type: string;
  display_name: string;
  legal_name: string | null;
  status: string;
  lifecycle_state: string;
  is_archived: boolean;
  created_at: string;
  updated_at?: string;
  business_type_display_he: string;
}

export function Clients() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang } = useI18n();
  const [list, setList] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createTaxId, setCreateTaxId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('business_customer');
  const [createPhone, setCreatePhone] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createWebsite, setCreateWebsite] = useState('');
  const [createCountry, setCreateCountry] = useState('');
  const [createCity, setCreateCity] = useState('');
  const [createStreet, setCreateStreet] = useState('');
  const [createPostalCode, setCreatePostalCode] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createInvalidField, setCreateInvalidField] = useState<CreateClientField | null>(null);
  const createInFlightRef = useRef(false);
  const createTaxIdRef = useRef<HTMLInputElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const createPhoneRef = useRef<HTMLInputElement>(null);
  const createEmailRef = useRef<HTMLInputElement>(null);
  const createTypeRef = useRef<HTMLSelectElement>(null);
  const [showImport, setShowImport] = useState(false);
  const [importAccept, setImportAccept] = useState<'.csv' | '.xlsx'>('.csv');
  const [importPickedFile, setImportPickedFile] = useState<File | null>(null);
  const [importFile, setImportFile] = useState<{ csv?: string; file_base64?: string; filename?: string } | null>(null);
  const [importColumnMap, setImportColumnMap] = useState<{ name?: string; tax_id?: string }>({});
  const [importPreview, setImportPreview] = useState<{
    valid_rows: Array<{ row_index: number; name: string; email?: string; company_name?: string; tax_id: string }>;
    duplicates: Array<{ row_index: number; name: string; tax_id: string; reason_code?: string }>;
    invalid_rows: Array<{ row_index: number; codes: string[]; name: string; tax_id: string }>;
    needs_column_mapping: boolean;
    headers: string[];
    suggested_map: { name?: string; tax_id?: string };
    new_count: number;
    duplicate_count: number;
    invalid_count: number;
  } | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sortOption, setSortOption] = useState(DEFAULT_SORT_OPTION);
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listLayout, setListLayout] = useState<'table' | 'cards'>('table');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(max-width: 768px)').matches) setListLayout('cards');
  }, []);

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const officeActions = auth.status === 'authenticated' && Array.isArray(auth.me.available_actions)
    ? auth.me.available_actions
    : [];
  const canWrite = officeActions.includes('create_client');
  const canImport = officeActions.includes('import_clients');
  const canInactive = officeActions.includes('mark_client_inactive');
  const canReactivate = officeActions.includes('reactivate_client');
  const canArchive = officeActions.includes('archive_client');
  const canRestore = officeActions.includes('restore_client');

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    const { sort_by, sort_dir } = getSortParams(sortOption);
    const params = new URLSearchParams();
    params.set('view', view);
    if (searchApplied.trim()) params.set('search', searchApplied.trim());
    if (includeArchived) params.set('includeArchived', 'true');
    params.set('sort_by', sort_by);
    params.set('sort_dir', sort_dir);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    apiJson<{ items: ClientRow[]; total: number; limit: number; offset: number; has_more: boolean }>(orgClients(orgId) + '?' + params.toString(), { signal: ac.signal })
      .then((data) => {
        if (!cancelled) {
          setList(Array.isArray(data.items) ? data.items : []);
          setTotal(typeof data.total === 'number' ? data.total : 0);
          setHasMore(Boolean(data.has_more));
        }
      })
      .catch((e) => {
        if (!cancelled && (e as Error)?.name !== 'AbortError') setError(userFacingApiMessage(e) || t('clients.errors.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [orgId, view, searchApplied, includeArchived, refreshTrigger, sortOption, limit, offset]);

  const applySearch = useCallback(() => {
    setSearchApplied(searchInput.trim());
    setOffset(0);
  }, [searchInput]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === list.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(list.map((c) => c.id)));
    }
  }, [list, selectedIds.size]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const runBulk = useCallback(
    async (action: 'mark-active' | 'mark-inactive' | 'archive' | 'restore') => {
      if (!orgId || selectedIds.size === 0) return;
      setBulkLoading(true);
      setError('');
      const clientIds = Array.from(selectedIds);
      const endpoints = {
        'mark-active': orgClientsBulkMarkActive(orgId),
        'mark-inactive': orgClientsBulkMarkInactive(orgId),
        archive: orgClientsBulkArchive(orgId),
        restore: orgClientsBulkRestore(orgId),
      };
      try {
        await apiJson(endpoints[action], { method: 'POST', body: JSON.stringify({ clientIds }) });
        clearSelection();
        setRefreshTrigger((t) => t + 1);
      } catch (e) {
        setError(userFacingApiMessage(e) || t('clients.errors.bulkFailed'));
      } finally {
        setBulkLoading(false);
      }
    },
    [orgId, selectedIds, clearSelection, t]
  );

  const exportSelected = useCallback(async () => {
    if (!orgId || selectedIds.size === 0 || !canWrite) return;
    setBulkLoading(true);
    setError('');
    try {
      const res = await apiFetch(orgClientsBulkExport(orgId), {
        method: 'POST',
        body: JSON.stringify({ clientIds: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error(t('clients.errors.exportFailed'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clients-selected-export.csv';
      a.click();
      URL.revokeObjectURL(url);
      clearSelection();
    } catch (e) {
      setError(userFacingApiMessage(e) || t('clients.errors.exportFailed'));
    } finally {
      setBulkLoading(false);
    }
  }, [orgId, selectedIds, canWrite, clearSelection]);

  const focusCreateField = (field: CreateClientField | null) => {
    const target = firstInvalidCreateClientFocusField(field);
    const node =
      target === 'tax_id' ? createTaxIdRef.current
      : target === 'display_name' ? createNameRef.current
      : target === 'client_type' ? createTypeRef.current
      : target === 'phone' ? createPhoneRef.current
      : null;
    node?.focus();
  };

  const createClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !canWrite) return;
    if (!beginExclusiveSubmit(createInFlightRef)) return;
    setCreateSubmitting(true);
    setCreateError('');
    setCreateInvalidField(null);
    const draft = {
      tax_id: createTaxId,
      display_name: createName,
      client_type: createType,
      phone: createPhone,
      email: createEmail,
      website: createWebsite,
      country_code: createCountry,
      city: createCity,
      street: createStreet,
      postal_code: createPostalCode,
    };
    const validation = validateCreateClientDraft(draft);
    if (!validation.ok) {
      setCreateInvalidField(validation.field);
      setCreateError(t(validation.messageKey));
      focusCreateField(validation.field);
      endExclusiveSubmit(createInFlightRef);
      setCreateSubmitting(false);
      return;
    }
    try {
      const created = await apiJson<{ id: string }>(orgClients(orgId), {
        method: 'POST',
        body: JSON.stringify(buildCreateClientCommandPayload(draft)),
      });
      const clientId = canonicalCreatedClientId(created);
      if (!clientId) {
        setCreateError(t('clients.errors.retryable'));
        return;
      }
      setShowCreate(false);
      setCreateError('');
      setCreateInvalidField(null);
      setCreateTaxId('');
      setCreateName('');
      setCreateType('business_customer');
      setCreatePhone('');
      setCreateEmail('');
      setCreateWebsite('');
      setCreateCountry('');
      setCreateCity('');
      setCreateStreet('');
      setCreatePostalCode('');
      const dest = createdClientDestination({ currentPath: location.pathname, clientId });
      navigate('/m/client-operations', {
        state: createdClientOpenLocationState({
          clientId: dest.clientId,
          displayName: createName,
          taxId: createTaxId,
          email: createEmail,
          phone: createPhone,
        }),
      });
    } catch (err) {
      const mapped = mapCreateClientCommandError(err);
      setCreateInvalidField(mapped.field);
      setCreateError(t(mapped.messageKey));
      focusCreateField(mapped.field);
    } finally {
      endExclusiveSubmit(createInFlightRef);
      setCreateSubmitting(false);
    }
  };

  const importIssueLabel = (code: string | undefined) => {
    if (!code) return t('clients.import.issues.GENERIC');
    const key = `clients.import.issues.${code}`;
    const label = t(key);
    return label === key ? t('clients.import.issues.GENERIC') : label;
  };

  const importRequestBody = (columnMap?: { name?: string; tax_id?: string }) => {
    const map = columnMap?.name && columnMap?.tax_id ? columnMap : undefined;
    return {
      csv: importFile?.csv,
      filename: importFile?.filename,
      file_base64: importFile?.file_base64,
      column_map: map,
    };
  };

  const closeImportPanel = () => {
    setShowImport(false);
    setImportPickedFile(null);
    setImportFile(null);
    setImportColumnMap({});
    setImportPreview(null);
    setError('');
  };

  const openImportPanel = (accept: '.csv' | '.xlsx') => {
    setImportAccept(accept);
    setShowImport(true);
    setImportPickedFile(null);
    setImportFile(null);
    setImportColumnMap({});
    setImportPreview(null);
    setError('');
  };

  const handleImportPickedFile = (file: File | null) => {
    setImportPickedFile(file);
    setImportPreview(null);
    setImportColumnMap({});
    setError('');
    if (!file) {
      setImportFile(null);
      return;
    }
    const name = file.name.toLowerCase();
    if (importAccept === '.csv' && !name.endsWith('.csv') && file.type !== 'text/csv') {
      setImportFile(null);
      setError(t('clients.import.issues.UNSUPPORTED_FILE_FORMAT'));
      return;
    }
    if (importAccept === '.xlsx' && !name.endsWith('.xlsx')) {
      setImportFile(null);
      setError(t('clients.import.issues.UNSUPPORTED_FILE_FORMAT'));
      return;
    }
    if (name.endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const comma = result.indexOf(',');
        setImportFile({ filename: file.name, file_base64: comma >= 0 ? result.slice(comma + 1) : result });
      };
      reader.readAsDataURL(file);
      return;
    }
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      const reader = new FileReader();
      reader.onload = () => {
        setImportFile({ filename: file.name, csv: String(reader.result ?? '') });
      };
      reader.readAsText(file, 'utf-8');
      return;
    }
    setImportFile(null);
    setError(t('clients.import.issues.UNSUPPORTED_FILE_FORMAT'));
  };

  const loadImportPreview = (columnMap = importColumnMap) => {
    if (!orgId || !importFile || !canImport) return;
    setImportLoading(true);
    setError('');
    apiJson<NonNullable<typeof importPreview>>(orgClientsImportPreview(orgId), {
      method: 'POST',
      body: JSON.stringify(importRequestBody(columnMap)),
    })
      .then((preview) => {
        setImportPreview(preview);
        if (preview.needs_column_mapping) {
          setImportColumnMap({
            name: columnMap.name || preview.suggested_map.name,
            tax_id: columnMap.tax_id || preview.suggested_map.tax_id,
          });
        }
      })
      .catch((e) => setError(userFacingApiMessage(e) || t('clients.errors.previewFailed')))
      .finally(() => setImportLoading(false));
  };

  const confirmImport = () => {
    if (!orgId || !importFile || !canImport) return;
    setImportLoading(true);
    setError('');
    apiJson<{ imported: number; skipped: number; errors: Array<{ row_index: number; code?: string }>; clients_list?: { items?: ClientRow[]; total?: number; has_more?: boolean } }>(
      orgClientsImportCommand(orgId),
      {
        method: 'POST',
        body: JSON.stringify(importRequestBody(importColumnMap)),
      },
    )
      .then((res) => {
        if (res.clients_list && Array.isArray(res.clients_list.items)) {
          setList(res.clients_list.items);
          if (typeof res.clients_list.total === 'number') setTotal(res.clients_list.total);
          setHasMore(Boolean(res.clients_list.has_more));
          setOffset(0);
        } else {
          setRefreshTrigger((n) => n + 1);
        }
        closeImportPanel();
      })
      .catch((e) => setError(userFacingApiMessage(e) || t('clients.errors.importFailed')))
      .finally(() => setImportLoading(false));
  };

  const downloadExport = async () => {
    if (!orgId || !canWrite) return;
    setExportLoading(true);
    setError('');
    try {
      const res = await apiFetch(orgClientsExport(orgId));
      if (!res.ok) throw new Error(t('clients.errors.exportFailed'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clients-export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(userFacingApiMessage(e) || t('clients.errors.exportFailed'));
    } finally {
      setExportLoading(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-clients-empty">{t('clients.selectOrganization')}</p>;

  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const importPreviewRows = importPreview && !importPreview.needs_column_mapping
    ? [
        ...importPreview.valid_rows.map((r) => ({ row_index: r.row_index, name: r.name, tax_id: r.tax_id, remark: '' })),
        ...importPreview.duplicates.map((r) => ({
          row_index: r.row_index,
          name: r.name,
          tax_id: r.tax_id,
          remark: importIssueLabel(r.reason_code),
        })),
        ...importPreview.invalid_rows.map((r) => ({
          row_index: r.row_index,
          name: r.name,
          tax_id: r.tax_id,
          remark: r.codes.map((code) => importIssueLabel(code)).join('; '),
        })),
      ].sort((a, b) => a.row_index - b.row_index)
    : [];

  return (
    <div className="nx-glass-page nx-glass-page--wide nx-clients nx-clients--deep-ocean nx-office-ocean" dir={dir} lang={lang}>
      <h1 className="nx-glass-title">{t('clients.title')}</h1>
      <p className="nx-glass-subtitle">{t('clients.subtitle')}</p>

      <section className="nx-glass-card">
        <div className="nx-clients-toolbar">
        <div className="nx-clients-toolbar__row">
          {canWrite && (
            <button type="button" onClick={() => { setShowCreate(true); setCreateError(''); setCreateInvalidField(null); }} className="nx-glass-btn nx-glass-btn--purple">
              {t('clients.newClient')}
            </button>
          )}
          {canWrite && canImport && (
            <>
              <button type="button" onClick={() => openImportPanel('.csv')} className="nx-glass-btn nx-glass-btn--secondary">
                {t('clients.importCsv')}
              </button>
              <button type="button" onClick={() => openImportPanel('.xlsx')} className="nx-glass-btn nx-glass-btn--secondary">
                {t('clients.importExcel')}
              </button>
            </>
          )}
          {canWrite && (
            <button type="button" onClick={downloadExport} disabled={exportLoading} className="nx-glass-btn nx-glass-btn--secondary">
              {exportLoading ? t('common.loading') : t('clients.exportCsv')}
            </button>
          )}
          <input
            type="text"
            placeholder={t('clients.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            className="nx-glass-input nx-glass-input--inline nx-clients-toolbar__search"
          />
          <button type="button" onClick={applySearch} className="nx-glass-btn nx-glass-btn--secondary">
            {t('clients.search')}
          </button>
          <span className="nx-clients-label">{t('clients.views.label')}</span>
          <select
            value={view}
            onChange={(e) => { setView(e.target.value); setOffset(0); }}
            className="nx-glass-input nx-glass-input--inline"
          >
            {VIEW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
          {(view !== 'all' && view !== 'archived') && (
            <label className="nx-clients-toolbar__archived">
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
              {t('clients.includeArchived')}
            </label>
          )}
          <span className="nx-clients-label">{t('clients.sort.label')}</span>
          <select
            value={sortOption}
            onChange={(e) => { setSortOption(e.target.value); setOffset(0); }}
            className="nx-glass-input nx-glass-input--inline"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
        </div>
      </div>
      </section>

      {selectedIds.size > 0 && (
        <div className="nx-glass-card nx-clients-bulk">
          <strong>{t('clients.bulk.selected').replace('{{count}}', String(selectedIds.size))}</strong>
          {canReactivate && (
              <button type="button" onClick={() => runBulk('mark-active')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                {t('clients.bulk.markActive')}
              </button>
          )}
          {canInactive && (
              <button type="button" onClick={() => runBulk('mark-inactive')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                {t('clients.bulk.markInactive')}
              </button>
          )}
          {canArchive && (
              <button type="button" onClick={() => runBulk('archive')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                {t('clients.bulk.archive')}
              </button>
          )}
          {canRestore && (
              <button type="button" onClick={() => runBulk('restore')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                {t('clients.bulk.restore')}
              </button>
          )}
          {canWrite && (
            <button type="button" onClick={exportSelected} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
              {t('clients.bulk.exportSelected')}
            </button>
          )}
          <button type="button" onClick={clearSelection} className="nx-glass-btn nx-glass-btn--secondary">
            {t('clients.bulk.clear')}
          </button>
        </div>
      )}

      {showImport && canImport && (
        <div className="nx-glass-card nx-clients-import">
          <h3>{t('clients.import.title')}</h3>
          <p className="nx-clients-hint">{t('clients.import.hint')}</p>
          <div className="nx-clients-toolbar__row">
            <GlassFilePicker
              accept={importAccept}
              file={importPickedFile}
              disabled={importLoading}
              onChange={handleImportPickedFile}
            />
            <button type="button" onClick={() => loadImportPreview()} disabled={!importFile || importLoading} className="nx-glass-btn nx-glass-btn--secondary">
              {importLoading ? t('common.loading') : t('clients.import.preview')}
            </button>
            <button type="button" onClick={closeImportPanel} className="nx-glass-btn nx-glass-btn--secondary">
              {t('common.cancel')}
            </button>
          </div>
          {importPreview?.needs_column_mapping && (
            <div className="nx-clients-toolbar__row">
              <label className="nx-clients-label">
                {t('clients.import.mapName')}
                <select
                  value={importColumnMap.name ?? ''}
                  onChange={(e) => setImportColumnMap((prev) => ({ ...prev, name: e.target.value || undefined }))}
                  className="nx-glass-input nx-glass-input--inline"
                >
                  <option value="">{t('clients.import.chooseColumn')}</option>
                  {importPreview.headers.map((header) => (
                    <option key={`name-${header}`} value={header}>{header}</option>
                  ))}
                </select>
              </label>
              <label className="nx-clients-label">
                {t('clients.import.mapTaxId')}
                <select
                  value={importColumnMap.tax_id ?? ''}
                  onChange={(e) => setImportColumnMap((prev) => ({ ...prev, tax_id: e.target.value || undefined }))}
                  className="nx-glass-input nx-glass-input--inline"
                >
                  <option value="">{t('clients.import.chooseColumn')}</option>
                  {importPreview.headers.map((header) => (
                    <option key={`tax-${header}`} value={header}>{header}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => loadImportPreview(importColumnMap)}
                disabled={!importColumnMap.name || !importColumnMap.tax_id || importLoading}
                className="nx-glass-btn nx-glass-btn--secondary"
              >
                {t('clients.import.preview')}
              </button>
            </div>
          )}
          {importPreview && !importPreview.needs_column_mapping && (
            <>
              <div className="nx-clients-toolbar__row">
                <span>{t('clients.import.valid').replace('{{count}}', String(importPreview.new_count))}</span>
                <span>{t('clients.import.duplicates').replace('{{count}}', String(importPreview.duplicate_count))}</span>
                <span>{t('clients.import.invalid').replace('{{count}}', String(importPreview.invalid_count))}</span>
              </div>
              {importPreviewRows.length > 0 && (
                <div className="nx-clients-preview">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t('clients.import.colName')}</th>
                        <th>{t('clients.import.colTaxId')}</th>
                        <th>{t('clients.import.colReason')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreviewRows.slice(0, 20).map((r) => (
                        <tr key={r.row_index}>
                          <td>{r.row_index}</td>
                          <td>{r.name}</td>
                          <td className="nx-ltr">{r.tax_id}</td>
                          <td>{r.remark || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreviewRows.length > 20 && (
                    <p className="nx-clients-hint">{t('clients.import.andMore').replace('{{count}}', String(importPreviewRows.length - 20))}</p>
                  )}
                </div>
              )}
              <button type="button" onClick={confirmImport} disabled={importLoading || importPreview.valid_rows.length === 0} className="nx-glass-btn nx-glass-btn--purple">
                {importLoading ? t('common.loading') : t('clients.import.confirm')}
              </button>
            </>
          )}
        </div>
      )}

      {showCreate && canWrite && (
        <div className={createClientOverlayClass(CREATE_CLIENT_MODAL_APPEARANCE)}>
          <div
            className="nx-glass-card nx-clients-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nx-clients-create-title"
            dir={lang === 'he' ? 'rtl' : 'ltr'}
          >
            <div className="nx-clients-modal__head">
              <h3 id="nx-clients-create-title">{t('clients.create.title')}</h3>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setCreateError(''); setCreateInvalidField(null); }}
                className="nx-clients-modal__close"
                aria-label={t('common.cancel')}
              >
                ×
              </button>
            </div>
            <form onSubmit={createClient} className="nx-clients-form" noValidate>
              <div className="nx-clients-form__body">
              {createError && (
                <div className="nx-client-create__span nx-glass-alert nx-glass-alert--error" role="alert">
                  {createError}
                </div>
              )}
              <label>
                <span className="nx-clients-form__label-line">
                  {t('clients.create.taxId')} <AccountRequiredMark />
                </span>
                <input
                  ref={createTaxIdRef}
                  type="text"
                  value={createTaxId}
                  onChange={(e) => { setCreateTaxId(e.target.value); if (createInvalidField === 'tax_id') setCreateInvalidField(null); }}
                  required
                  aria-invalid={createInvalidField === 'tax_id'}
                  className={`nx-glass-input nx-ltr${createInvalidField === 'tax_id' ? ' is-invalid' : ''}`}
                />
              </label>
              <label>
                <span className="nx-clients-form__label-line">
                  {t('clients.create.displayName')} <AccountRequiredMark />
                </span>
                <input
                  ref={createNameRef}
                  type="text"
                  value={createName}
                  onChange={(e) => { setCreateName(e.target.value); if (createInvalidField === 'display_name') setCreateInvalidField(null); }}
                  required
                  aria-invalid={createInvalidField === 'display_name'}
                  className={`nx-glass-input${createInvalidField === 'display_name' ? ' is-invalid' : ''}`}
                />
              </label>
              <label>
                {t('clients.create.type')}
                <select
                  ref={createTypeRef}
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value)}
                  aria-invalid={createInvalidField === 'client_type'}
                  className={`nx-glass-input${createInvalidField === 'client_type' ? ' is-invalid' : ''}`}
                >
                  <option value="business_customer">{t('clients.type.business_customer')}</option>
                  <option value="individual_customer">{t('clients.type.individual_customer')}</option>
                  <option value="supplier">{t('clients.type.supplier')}</option>
                  <option value="partner">{t('clients.type.partner')}</option>
                  <option value="other">{t('clients.type.other')}</option>
                </select>
              </label>
              <label>
                {t('clients.contact.website')}
                <input type="url" value={createWebsite} onChange={(e) => setCreateWebsite(e.target.value)} placeholder="https://" className="nx-glass-input nx-ltr" />
              </label>
              <h4 className="nx-client-create__span">
                {t('clients.contact.section')}{' '}
                <AccountRequiredMark />
                <span className="nx-clients-required-caption"> {t('clients.contact.orRequired')}</span>
              </h4>
              <label>
                {t('clients.details.phone')}
                <input
                  ref={createPhoneRef}
                  type="text"
                  value={createPhone}
                  onChange={(e) => { setCreatePhone(e.target.value); if (createInvalidField === 'contact') setCreateInvalidField(null); }}
                  placeholder={t('clients.contact.phonePlaceholder')}
                  aria-invalid={createInvalidField === 'contact'}
                  aria-describedby="nx-clients-create-contact-error"
                  className={`nx-glass-input nx-ltr${createInvalidField === 'contact' ? ' is-invalid' : ''}`}
                />
              </label>
              <label>
                {t('clients.details.email')}
                <input
                  ref={createEmailRef}
                  type="email"
                  value={createEmail}
                  onChange={(e) => { setCreateEmail(e.target.value); if (createInvalidField === 'contact') setCreateInvalidField(null); }}
                  placeholder={t('clients.contact.emailPlaceholder')}
                  aria-invalid={createInvalidField === 'contact'}
                  aria-describedby="nx-clients-create-contact-error"
                  className={`nx-glass-input nx-ltr${createInvalidField === 'contact' ? ' is-invalid' : ''}`}
                />
              </label>
              <p
                id="nx-clients-create-contact-error"
                className={`nx-client-create__span ${createInvalidField === 'contact' ? 'nx-clients-field-error' : 'nx-clients-hint'}`}
                role={createInvalidField === 'contact' ? 'alert' : undefined}
              >
                {t('clients.contact.requiredHint')}
              </p>
              <h4 className="nx-client-create__span">{t('clients.address.section')}</h4>
              <label>
                {t('clients.address.country')}
                <input type="text" value={createCountry} onChange={(e) => setCreateCountry(e.target.value)} placeholder="IL" maxLength={2} className="nx-glass-input nx-ltr" />
              </label>
              <label>
                {t('clients.address.city')}
                <input type="text" value={createCity} onChange={(e) => setCreateCity(e.target.value)} className="nx-glass-input" />
              </label>
              <label>
                {t('clients.address.street')}
                <input type="text" value={createStreet} onChange={(e) => setCreateStreet(e.target.value)} className="nx-glass-input" />
              </label>
              <label>
                {t('clients.address.postalCode')}
                <input type="text" value={createPostalCode} onChange={(e) => setCreatePostalCode(e.target.value)} className="nx-glass-input" />
              </label>
              </div>
              <div className="nx-clients-form__footer">
                <button type="submit" disabled={createSubmitting} className="nx-glass-btn nx-glass-btn--purple">
                  {createSubmitting ? t('common.loading') : t('common.create')}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setCreateError(''); setCreateInvalidField(null); }}
                  className="nx-glass-btn nx-glass-btn--secondary"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {error && <div className="nx-glass-alert nx-glass-alert--error">{error}</div>}

      {loading ? (
        <p className="nx-clients-empty">{t('common.loading')}</p>
      ) : (
        <section className="nx-glass-card nx-clients-table-card">
          {listLayout === 'cards' ? (
            <div className="nx-clients-cards">
              {list.map((c) => (
                <div className="nx-clients-card-item" key={c.id}>
                  <label className="nx-clients-table__check">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      aria-label={t('clients.selectRow').replace('{{name}}', c.display_name)}
                    />
                  </label>
                  <div className="nx-clients-card-item__body">
                    <strong>{c.display_name}</strong>
                    <p className="nx-clients-table__mono"><span className="nx-ltr">{c.tax_id ?? '—'}</span></p>
                    <p>{c.business_type_display_he}</p>
                    <p>{lookupLabel(t, `clients.statusValue.${c.status}`, c.status)}</p>
                    <p className="nx-clients-table__muted">
                      {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'}
                      {c.is_archived ? ` · ${t('common.archived')}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <div className="nx-clients-table-wrap">
          <table className="nx-clients-table">
            <thead>
              <tr>
                <th className="nx-clients-table__check">
                  <input
                    type="checkbox"
                    checked={list.length > 0 && selectedIds.size === list.length}
                    onChange={toggleSelectAll}
                    aria-label={t('clients.selectAll')}
                  />
                </th>
                <th>{t('clients.table.name')}</th>
                <th className="nx-clients-table__tax">{t('clients.table.taxId')}</th>
                <th>{t('clients.table.type')}</th>
                <th>{t('clients.table.status')}</th>
                <th>{t('clients.updated')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="nx-clients-table__check">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      aria-label={t('clients.selectRow').replace('{{name}}', c.display_name)}
                    />
                  </td>
                  <td>{c.display_name}</td>
                  <td className="nx-clients-table__tax nx-clients-table__mono">
                    <span className="nx-ltr">{c.tax_id ?? '—'}</span>
                  </td>
                  <td>{c.business_type_display_he}</td>
                  <td>{lookupLabel(t, `clients.statusValue.${c.status}`, c.status)}</td>
                  <td className="nx-clients-table__muted">
                    {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td>{c.is_archived ? <span className="nx-clients-table__muted">{t('common.archived')}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}
          {list.length === 0 && (
            <p className="nx-clients-empty">
              {searchApplied ? t('clients.noResultsSearch') : t('clients.empty')}
            </p>
          )}
          <div className="nx-clients-pager" data-testid="clients-pagination">
            <span className="nx-clients-label">{t('clients.perPage')}</span>
            <select
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}
              className="nx-glass-input nx-glass-input--inline nx-clients-toolbar__limit"
              aria-label={t('clients.perPage')}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              className="nx-glass-btn nx-glass-btn--secondary"
            >
              {t('clients.previous')}
            </button>
            <button
              type="button"
              disabled={!hasMore || loading}
              onClick={() => setOffset((o) => o + limit)}
              className="nx-glass-btn nx-glass-btn--secondary"
            >
              {t('clients.next')}
            </button>
            {total > 0 ? (
              <span className="nx-clients-toolbar__meta">
                {t('clients.showing')} {offset + 1}–{Math.min(offset + limit, total)} {t('clients.of')} {total}
              </span>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson, apiFetch } from '../api/client';
import {
  orgClients,
  orgClientsImportPreview,
  orgClientsImport,
  orgClientsExport,
  orgClientsBulkMarkActive,
  orgClientsBulkMarkInactive,
  orgClientsBulkArchive,
  orgClientsBulkRestore,
  orgClientsBulkExport,
} from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { canonicalCreatedClientId, clientCardPath } from './client-create-navigation.pure';
import '../styles/nx-glass-surface.css';
import '../styles/nx-clients.css';

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
}

export function Clients() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
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
  const [showImport, setShowImport] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [importPreview, setImportPreview] = useState<{
    valid_rows: Array<{ row_index: number; name: string; email: string; phone: string; company_name: string; tax_id: string; address: string; city: string; country: string; notes: string }>;
    duplicates: Array<{ row_index: number; name: string; reason?: string }>;
    invalid_rows: Array<{ row_index: number; errors: string[]; raw: Record<string, string> }>;
  } | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: Array<{ row_index: number; message: string }> } | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sortOption, setSortOption] = useState(DEFAULT_SORT_OPTION);
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

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
        if (!cancelled && (e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : 'Failed to load');
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
        setError(e instanceof Error ? e.message : 'Bulk action failed');
      } finally {
        setBulkLoading(false);
      }
    },
    [orgId, selectedIds, clearSelection]
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
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clients-selected-export.csv';
      a.click();
      URL.revokeObjectURL(url);
      clearSelection();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBulkLoading(false);
    }
  }, [orgId, selectedIds, canWrite, clearSelection]);

  const createClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !createTaxId.trim() || !createName.trim() || !canWrite) return;
    setCreateSubmitting(true);
    setError('');
    try {
      const created = await apiJson<{ id: string }>(orgClients(orgId), {
        method: 'POST',
        body: JSON.stringify({
          tax_id: createTaxId.trim(),
          display_name: createName.trim(),
          client_type: createType,
          phone: createPhone.trim() || null,
          email: createEmail.trim() || null,
          website: createWebsite.trim() || null,
          country_code: createCountry.trim().slice(0, 2) || null,
          city: createCity.trim() || null,
          street: createStreet.trim() || null,
          postal_code: createPostalCode.trim() || null,
        }),
      });
      const clientId = canonicalCreatedClientId(created);
      if (!clientId) throw new Error('Failed to create client');
      setShowCreate(false);
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
      navigate(clientCardPath(clientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setImportCsv(text);
      setImportPreview(null);
      setImportResult(null);
    };
    reader.readAsText(file, 'utf-8');
  };

  const loadImportPreview = () => {
    if (!orgId || !importCsv.trim() || !canWrite) return;
    setImportLoading(true);
    setError('');
    apiJson<typeof importPreview>(orgClientsImportPreview(orgId), {
      method: 'POST',
      body: JSON.stringify({ csv: importCsv }),
    })
      .then(setImportPreview)
      .catch((e) => setError(e instanceof Error ? e.message : 'Preview failed'))
      .finally(() => setImportLoading(false));
  };

  const confirmImport = () => {
    if (!orgId || !importCsv.trim() || !canWrite) return;
    setImportLoading(true);
    setError('');
    apiJson<{ imported: number; skipped: number; errors: Array<{ row_index: number; message: string }> }>(orgClientsImport(orgId), {
      method: 'POST',
      body: JSON.stringify({ csv: importCsv }),
    })
      .then((res) => {
        setImportResult(res);
        setImportPreview(null);
        setImportCsv('');
        setRefreshTrigger((t) => t + 1);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Import failed'))
      .finally(() => setImportLoading(false));
  };

  const downloadExport = async () => {
    if (!orgId || !canWrite) return;
    setExportLoading(true);
    setError('');
    try {
      const res = await apiFetch(orgClientsExport(orgId));
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clients-export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-clients-empty">Select an organization.</p>;

  return (
    <div className="nx-glass-page nx-glass-page--wide nx-clients">
      <h1 className="nx-glass-title">{t('clients.title')}</h1>
      <p className="nx-glass-subtitle">{t('clients.subtitle')}</p>

      <section className="nx-glass-card">
        <div className="nx-clients-toolbar">
        <div className="nx-clients-toolbar__row nx-clients-toolbar__row--split">
          <div className="nx-clients-toolbar__row">
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
            <input
              type="text"
              placeholder={t('clients.searchPlaceholder')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              className="nx-glass-input nx-glass-input--inline"
              style={{ width: 220 }}
            />
            <button type="button" onClick={applySearch} className="nx-glass-btn nx-glass-btn--secondary">
              {t('clients.search')}
            </button>
            {(view !== 'all' && view !== 'archived') && (
              <label className="nx-clients-toolbar__row" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
                {t('clients.includeArchived')}
              </label>
            )}
          </div>
          {canWrite && (
            <div className="nx-clients-toolbar__row" style={{ gap: 8 }}>
              <button type="button" onClick={() => setShowCreate(true)} className="nx-glass-btn nx-glass-btn--purple">
                {t('clients.newClient')}
              </button>
              {canImport && (
              <button type="button" onClick={() => setShowImport(true)} className="nx-glass-btn nx-glass-btn--secondary">
                Import CSV
              </button>
              )}
              <button type="button" onClick={downloadExport} disabled={exportLoading} className="nx-glass-btn nx-glass-btn--secondary">
                {exportLoading ? t('common.loading') : 'Export CSV'}
              </button>
            </div>
          )}
        </div>
        <div className="nx-clients-toolbar__row nx-clients-toolbar__meta">
          <span>{t('clients.sort.label')}</span>
          <select
            value={sortOption}
            onChange={(e) => { setSortOption(e.target.value); setOffset(0); }}
            className="nx-glass-input nx-glass-input--inline"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
          <span>{t('clients.perPage')}</span>
          <select
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}
            className="nx-glass-input nx-glass-input--inline"
            style={{ minWidth: 80 }}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          {total > 0 && (
            <>
              <span>
                {t('clients.showing')} {offset + 1}–{Math.min(offset + limit, total)} {t('clients.of')} {total}
              </span>
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
            </>
          )}
        </div>
      </div>
      </section>

      {selectedIds.size > 0 && (
        <div className="nx-glass-card nx-clients-bulk">
          <strong>{selectedIds.size} selected</strong>
          {canReactivate && (
              <button type="button" onClick={() => runBulk('mark-active')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                Mark active
              </button>
          )}
          {canInactive && (
              <button type="button" onClick={() => runBulk('mark-inactive')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                Mark inactive
              </button>
          )}
          {canArchive && (
              <button type="button" onClick={() => runBulk('archive')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                Archive
              </button>
          )}
          {canRestore && (
              <button type="button" onClick={() => runBulk('restore')} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
                Restore
              </button>
          )}
          {canWrite && (
            <button type="button" onClick={exportSelected} disabled={bulkLoading} className="nx-glass-btn nx-glass-btn--secondary">
              Export selected
            </button>
          )}
          <button type="button" onClick={clearSelection} className="nx-glass-btn nx-glass-btn--secondary">
            Clear
          </button>
        </div>
      )}

      {showImport && canImport && (
        <div className="nx-glass-card nx-clients-import">
          <h3>Import clients (CSV)</h3>
          <p>Columns: name (required), email, phone, company_name, tax_id, address, city, country, notes. Max 10,000 rows.</p>
          <div className="nx-clients-toolbar__row" style={{ marginBottom: 16 }}>
            <input type="file" accept=".csv" onChange={handleImportFile} style={{ maxWidth: 280 }} />
            <button type="button" onClick={loadImportPreview} disabled={!importCsv.trim() || importLoading} className="nx-glass-btn nx-glass-btn--secondary">
              {importLoading ? t('common.loading') : 'Preview'}
            </button>
            <button type="button" onClick={() => { setShowImport(false); setImportCsv(''); setImportPreview(null); setImportResult(null); setError(''); }} className="nx-glass-btn nx-glass-btn--secondary">
              {t('common.cancel')}
            </button>
          </div>
          {importPreview && (
            <>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <span>Valid: {importPreview.valid_rows.length}</span>
                <span>Duplicates (will skip): {importPreview.duplicates.length}</span>
                <span>Invalid: {importPreview.invalid_rows.length}</span>
              </div>
              {importPreview.valid_rows.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <strong>Valid rows (to import)</strong>
                  <div className="nx-clients-preview">
                    <table>
                      <thead><tr><th>#</th><th>name</th><th>email</th><th>company_name</th></tr></thead>
                      <tbody>
                        {importPreview.valid_rows.slice(0, 20).map((r) => (
                          <tr key={r.row_index}><td>{r.row_index}</td><td>{r.name}</td><td>{r.email}</td><td>{r.company_name}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {importPreview.valid_rows.length > 20 && <p className="nx-clients-hint" style={{ padding: 8 }}>… and {importPreview.valid_rows.length - 20} more</p>}
                  </div>
                </div>
              )}
              {importPreview.duplicates.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <strong>Duplicates (skipped)</strong>
                  <div className="nx-clients-preview">
                    <table>
                      <thead><tr><th>#</th><th>name</th><th>reason</th></tr></thead>
                      <tbody>
                        {importPreview.duplicates.slice(0, 10).map((r) => (
                          <tr key={r.row_index}><td>{r.row_index}</td><td>{r.name}</td><td>{r.reason ?? '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {importPreview.duplicates.length > 10 && <p className="nx-clients-hint" style={{ padding: 8 }}>… and {importPreview.duplicates.length - 10} more</p>}
                  </div>
                </div>
              )}
              {importPreview.invalid_rows.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <strong>Invalid rows</strong>
                  <div className="nx-clients-preview">
                    <table>
                      <thead><tr><th>#</th><th>errors</th></tr></thead>
                      <tbody>
                        {importPreview.invalid_rows.slice(0, 10).map((r) => (
                          <tr key={r.row_index}><td>{r.row_index}</td><td>{r.errors.join('; ')}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {importPreview.invalid_rows.length > 10 && <p className="nx-clients-hint" style={{ padding: 8 }}>… and {importPreview.invalid_rows.length - 10} more</p>}
                  </div>
                </div>
              )}
              <button type="button" onClick={confirmImport} disabled={importLoading || importPreview.valid_rows.length === 0} className="nx-glass-btn nx-glass-btn--purple">
                {importLoading ? t('common.loading') : 'Confirm import'}
              </button>
            </>
          )}
          {importResult && (
            <div className="nx-glass-alert" style={{ marginTop: 12 }}>
              <strong>Import complete:</strong> {importResult.imported} imported, {importResult.skipped} skipped, {importResult.errors.length} errors.
            </div>
          )}
        </div>
      )}

      {showCreate && canWrite && (
        <div className="nx-clients-overlay">
          <div className="nx-glass-card nx-clients-modal">
            <div className="nx-clients-modal__head">
              <h3>{t('clients.create.title')}</h3>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setError(''); }}
                className="nx-clients-modal__close"
                aria-label={t('common.cancel')}
              >
                ×
              </button>
            </div>
            <form onSubmit={createClient} className="nx-clients-form">
              <label>
                {t('clients.create.taxId')} <span className="nx-clients-required">*</span>
                <input type="text" value={createTaxId} onChange={(e) => setCreateTaxId(e.target.value)} required className="nx-glass-input" />
              </label>
              <label>
                {t('clients.create.displayName')} <span className="nx-clients-required">*</span>
                <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} required className="nx-glass-input" />
              </label>
              <label>
                {t('clients.create.type')}
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value)}
                  className="nx-glass-input"
                >
                  <option value="business_customer">{t('clients.type.business_customer')}</option>
                  <option value="individual_customer">{t('clients.type.individual_customer')}</option>
                  <option value="supplier">{t('clients.type.supplier')}</option>
                  <option value="partner">{t('clients.type.partner')}</option>
                  <option value="other">{t('clients.type.other')}</option>
                </select>
              </label>
              <h4>{t('clients.contact.section')}</h4>
              <label>
                {t('clients.details.phone')}
                <input type="text" value={createPhone} onChange={(e) => setCreatePhone(e.target.value)} placeholder={t('clients.contact.phonePlaceholder')} className="nx-glass-input" />
              </label>
              <label>
                {t('clients.details.email')}
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder={t('clients.contact.emailPlaceholder')}
                  className="nx-glass-input"
                />
              </label>
              <p className="nx-clients-hint">{t('clients.contact.requiredHint')}</p>
              <label>
                {t('clients.contact.website')}
                <input type="url" value={createWebsite} onChange={(e) => setCreateWebsite(e.target.value)} placeholder="https://" className="nx-glass-input" />
              </label>
              <h4>{t('clients.address.section')}</h4>
              <label>
                {t('clients.address.country')}
                <input type="text" value={createCountry} onChange={(e) => setCreateCountry(e.target.value)} placeholder="IL" maxLength={2} className="nx-glass-input" />
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
              <div className="nx-clients-toolbar__row" style={{ marginTop: 8 }}>
                <button type="submit" disabled={createSubmitting} className="nx-glass-btn nx-glass-btn--purple">
                  {createSubmitting ? t('common.loading') : t('common.create')}
                </button>
                <button type="button" onClick={() => { setShowCreate(false); setError(''); }} className="nx-glass-btn nx-glass-btn--secondary">
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
        <section className="nx-glass-card nx-clients-table-wrap">
          <table className="nx-clients-table">
            <thead>
              <tr>
                <th className="nx-clients-table__check">
                  <input
                    type="checkbox"
                    checked={list.length > 0 && selectedIds.size === list.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th>{t('clients.table.name')}</th>
                <th>{t('clients.table.taxId')}</th>
                <th>{t('clients.table.type')}</th>
                <th>{t('clients.table.status')}</th>
                <th>{t('clients.table.lifecycle')}</th>
                <th>Updated</th>
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
                      aria-label={`Select ${c.display_name}`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => navigate(clientCardPath(c.id))}
                      className="nx-clients-table__name"
                    >
                      {c.display_name}
                    </button>
                  </td>
                  <td className="nx-clients-table__mono">{c.tax_id ?? '—'}</td>
                  <td>{t(`clients.type.${c.client_type}`)}</td>
                  <td>{c.status}</td>
                  <td>{c.lifecycle_state}</td>
                  <td className="nx-clients-table__muted">
                    {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td>{c.is_archived ? <span className="nx-clients-table__muted">Archived</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && (
            <p className="nx-clients-empty">
              {searchApplied ? t('clients.noResultsSearch') : t('clients.empty')}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { orgDocuments, orgDocumentsUpload } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { GlassFilePicker } from '../components/glass/GlassFilePicker';
import '../styles/nx-glass-surface.css';

interface DocumentRow {
  id: string;
  document_code: string | null;
  title: string | null;
  document_type_code: string;
  lifecycle_state: string;
  status: string;
  issue_date: string | null;
  document_date: string | null;
  amount_total: number | null;
  currency: string | null;
  is_archived: boolean;
  created_at: string;
}

const DOC_TYPE_CODES = [
  'invoice',
  'receipt',
  'contract',
  'statement',
  'payroll_document',
  'tax_document',
  'other',
] as const;

export function Documents() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [list, setList] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [documentType, setDocumentType] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const canWrite = auth.status === 'authenticated' && auth.me?.permissions?.includes('documents:write');

  const typeLabel = (code: string) => {
    const key = `documents.types.${code}`;
    const label = t(key);
    return label === key ? code : label;
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : '');
      };
      reader.onerror = () => reject(new Error(t('documents.errors.readFile')));
      reader.readAsDataURL(file);
    });

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    let url = orgDocuments(orgId);
    const params = new URLSearchParams();
    if (includeArchived) params.set('includeArchived', 'true');
    if (documentType) params.set('documentType', documentType);
    if (params.toString()) url += '?' + params.toString();
    apiJson<DocumentRow[]>(url, { signal: ac.signal })
      .then((data) => {
        if (!cancelled) setList(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled && (e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : t('documents.errors.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [orgId, includeArchived, documentType]);

  const uploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !selectedFile || !canWrite) return;
    setUploading(true);
    setError('');
    try {
      const fileBase64 = await fileToBase64(selectedFile);
      const result = await apiJson<{ document: { id: string } }>(orgDocumentsUpload(orgId), {
        method: 'POST',
        body: JSON.stringify({
          file_name: selectedFile.name,
          mime_type: selectedFile.type || null,
          file_size: selectedFile.size,
          file_base64: fileBase64,
        }),
      });
      setShowUpload(false);
      setSelectedFile(null);
      navigate(`/documents/${result.document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('documents.errors.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-glass-page">{t('topBar.selectOrg')}</p>;

  return (
    <div className="nx-glass-page nx-glass-page--wide" data-testid="nx-documents">
      <h1 className="nx-glass-title">{t('documents.title')}</h1>
      <p className="nx-glass-subtitle">{t('documents.subtitle')}</p>

      <div className="nx-glass-toolbar">
        {canWrite && (
          <button
            type="button"
            className="nx-glass-btn nx-glass-btn--purple"
            onClick={() => setShowUpload(true)}
          >
            {t('documents.upload')}
          </button>
        )}
        <select
          className="nx-glass-input nx-glass-input--inline"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          aria-label={t('documents.typeFilter')}
        >
          <option value="">{t('documents.allTypes')}</option>
          {DOC_TYPE_CODES.map((code) => (
            <option key={code} value={code}>
              {typeLabel(code)}
            </option>
          ))}
        </select>
        <label className="nx-glass-check">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          {t('documents.includeArchived')}
        </label>
      </div>

      {showUpload && canWrite && (
        <form className="nx-glass-card" onSubmit={uploadDocument}>
          <h2>{t('documents.upload')}</h2>
          <div className="nx-glass-toolbar" style={{ marginBottom: 0 }}>
            <GlassFilePicker
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt,.csv"
              file={selectedFile}
              disabled={uploading}
              onChange={setSelectedFile}
            />
            <button
              type="submit"
              className="nx-glass-btn nx-glass-btn--purple"
              disabled={!selectedFile || uploading}
            >
              {uploading ? t('documents.uploading') : t('documents.upload')}
            </button>
            <button
              type="button"
              className="nx-glass-btn nx-glass-btn--secondary"
              onClick={() => {
                setShowUpload(false);
                setSelectedFile(null);
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="nx-glass-alert nx-glass-alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="nx-glass-muted">{t('common.loading')}</p>
      ) : (
        <div className="nx-glass-card">
          <div className="nx-glass-table-wrap">
            <table className="nx-glass-table">
              <thead>
                <tr>
                  <th>{t('documents.columns.title')}</th>
                  <th>{t('documents.columns.type')}</th>
                  <th>{t('documents.columns.status')}</th>
                  <th>{t('documents.columns.date')}</th>
                  <th className="is-num">{t('documents.columns.amount')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr
                    key={d.id}
                    className="is-clickable"
                    onClick={() => navigate(`/documents/${d.id}`)}
                  >
                    <td>{d.title ?? d.document_code ?? '—'}</td>
                    <td>{typeLabel(d.document_type_code)}</td>
                    <td>{d.lifecycle_state}</td>
                    <td>
                      {(d.document_date ?? d.issue_date ?? d.created_at)
                        ? new Date(d.document_date ?? d.issue_date ?? d.created_at!).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="is-num">
                      {d.amount_total != null ? `${d.amount_total} ${d.currency ?? ''}`.trim() : '—'}
                    </td>
                    <td>{d.is_archived && <span className="nx-glass-badge">{t('common.archived')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length === 0 && <p className="nx-glass-muted">{t('documents.empty')}</p>}
        </div>
      )}
    </div>
  );
}

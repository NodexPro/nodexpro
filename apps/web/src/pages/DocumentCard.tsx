import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import {
  orgDocument,
  orgDocumentFull,
  orgDocumentVersions,
  orgDocumentOpen,
  orgDocumentLinks,
  orgClients,
} from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { GlassFilePicker } from '../components/glass/GlassFilePicker';
import '../styles/nx-glass-surface.css';
import '../styles/nx-office-deep-ocean.css';

interface Document {
  id: string;
  title: string | null;
  document_type_code: string;
  lifecycle_state: string;
  status: string;
  primary_client_id: string | null;
  issue_date: string | null;
  document_date: string | null;
  amount_total: number | null;
  currency: string | null;
  external_reference: string | null;
  is_archived: boolean;
  current_version_id: string | null;
  created_by: string;
  created_at: string;
}

interface Version {
  id: string;
  version_number: number;
  original_file_name: string;
  mime_type: string | null;
  file_size: number | null;
  created_by: string;
  created_at: string;
  is_current: boolean;
}

interface Link {
  id: string;
  target_entity_type: string;
  target_entity_id: string;
  relation_type: string;
  is_primary: boolean;
}

interface Activity {
  id: string;
  event_type: string;
  created_at: string;
  payload_json: Record<string, unknown> | null;
}

interface Client {
  id: string;
  display_name: string;
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

export function DocumentCard() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const { t } = useI18n();
  const [doc, setDoc] = useState<Document | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState('other');
  const [editAmount, setEditAmount] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editDate, setEditDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [linkClientId, setLinkClientId] = useState('');
  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const clientsLoadedRef = useRef(false);

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const canWrite = auth.status === 'authenticated' && auth.me?.permissions?.includes('documents:write');
  const canArchive = auth.status === 'authenticated' && auth.me?.permissions?.includes('documents:archive');

  const typeLabel = (code: string) => {
    const key = `documents.types.${code}`;
    const label = t(key);
    return label === key ? code : label;
  };

  useEffect(() => {
    if (!orgId || !documentId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    apiJson<{ document: Document; versions: Version[]; links: Link[]; activity: Activity[] }>(orgDocumentFull(orgId, documentId), { signal: ac.signal })
      .then((data) => {
        if (cancelled) return;
        const d = data.document;
        setDoc(d);
        setVersions(Array.isArray(data.versions) ? data.versions : []);
        setLinks(Array.isArray(data.links) ? data.links : []);
        setActivity(Array.isArray(data.activity) ? data.activity : []);
        setEditTitle(d.title ?? '');
        setEditType(d.document_type_code);
        setEditAmount(d.amount_total != null ? String(d.amount_total) : '');
        setEditCurrency(d.currency ?? '');
        setEditDate(d.document_date ?? d.issue_date ?? '');
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
  }, [orgId, documentId]);

  useEffect(() => {
    if (!doc || !canWrite || !orgId || clientsLoadedRef.current) return;
    clientsLoadedRef.current = true;
    const ac = new AbortController();
    let cancelled = false;
    apiJson<Client[]>(orgClients(orgId), { signal: ac.signal })
      .then((c) => {
        if (!cancelled) setClients(Array.isArray(c) ? c : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ac.abort();
      clientsLoadedRef.current = false;
    };
  }, [doc, canWrite, orgId]);

  const openFile = async (versionId?: string) => {
    if (!orgId || !documentId) return;
    setError('');
    try {
      const url = versionId ? `${orgDocumentOpen(orgId, documentId)}?versionId=${versionId}` : orgDocumentOpen(orgId, documentId);
      const { url: signedUrl } = await apiJson<{ url: string }>(url);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('documents.errors.openFailed'));
    }
  };

  const refetchDoc = () => orgId && documentId && apiJson<Document>(orgDocument(orgId, documentId)).then(setDoc).catch(() => {});
  const refetchLinks = () => orgId && documentId && apiJson<Link[]>(orgDocumentLinks(orgId, documentId)).then((l) => setLinks(Array.isArray(l) ? l : [])).catch(() => {});
  const refetchVersions = () => orgId && documentId && apiJson<Version[]>(orgDocumentVersions(orgId, documentId)).then((v) => setVersions(Array.isArray(v) ? v : [])).catch(() => {});

  const saveDocument = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !documentId || !canWrite) return;
    setSaving(true);
    setError('');
    try {
      const updated = await apiJson<Document>(orgDocument(orgId, documentId), {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle.trim() || null,
          document_type_code: editType,
          amount_total: editAmount ? parseFloat(editAmount) : null,
          currency: editCurrency || null,
          document_date: editDate || null,
        }),
      });
      setEditing(false);
      if (updated) setDoc(updated);
      else refetchDoc();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('documents.errors.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const archiveDocument = async () => {
    if (!orgId || !documentId || !canArchive) return;
    if (!window.confirm(t('documents.archiveConfirm'))) return;
    setError('');
    try {
      await apiJson(orgDocument(orgId, documentId) + '/archive', { method: 'POST', body: '{}' });
      navigate('/documents');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('documents.errors.archiveFailed'));
    }
  };

  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !documentId || !linkClientId || !canWrite) return;
    setError('');
    try {
      await apiJson(orgDocumentLinks(orgId, documentId), {
        method: 'POST',
        body: JSON.stringify({ target_entity_type: 'client', target_entity_id: linkClientId, is_primary: links.length === 0 }),
      });
      setLinkClientId('');
      refetchLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('documents.errors.addLinkFailed'));
    }
  };

  const removeLink = async (linkId: string) => {
    if (!orgId || !documentId || !canWrite) return;
    setError('');
    try {
      await apiJson(`${orgDocumentLinks(orgId, documentId)}/${linkId}`, { method: 'DELETE' });
      refetchLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('documents.errors.removeLinkFailed'));
    }
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

  const uploadNewVersion = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !documentId || !newVersionFile || !canWrite) return;
    setUploadingVersion(true);
    setError('');
    try {
      const fileBase64 = await fileToBase64(newVersionFile);
      await apiJson(orgDocumentVersions(orgId, documentId), {
        method: 'POST',
        body: JSON.stringify({
          file_name: newVersionFile.name,
          mime_type: newVersionFile.type || null,
          file_size: newVersionFile.size,
          file_base64: fileBase64,
        }),
      });
      setNewVersionFile(null);
      refetchVersions();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('documents.errors.uploadVersionFailed'));
    } finally {
      setUploadingVersion(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-glass-page">{t('topBar.selectOrg')}</p>;
  if (!documentId) return <p className="nx-glass-page">{t('documents.noDocument')}</p>;
  if (loading) return <p className="nx-glass-page">{t('common.loading')}</p>;
  if (!doc) return <p className="nx-glass-page">{t('documents.notFound')}</p>;

  return (
    <div className="nx-glass-page nx-glass-page--wide nx-office-ocean" data-testid="nx-document-card">
      <div className="nx-glass-header-row">
        <button type="button" className="nx-glass-btn nx-glass-btn--secondary" onClick={() => navigate('/documents')}>
          {t('documents.back')}
        </button>
        <h1 className="nx-glass-title">{doc.title ?? t('documents.untitled')}</h1>
        {doc.is_archived && <span className="nx-glass-badge">{t('common.archived')}</span>}
        {canArchive && !doc.is_archived && (
          <button type="button" className="nx-glass-btn nx-glass-btn--danger" onClick={archiveDocument}>
            {t('documents.archive')}
          </button>
        )}
      </div>

      {error && (
        <div className="nx-glass-alert nx-glass-alert--error" role="alert">
          {error}
        </div>
      )}

      <section className="nx-glass-card">
        <h2>{t('documents.details')}</h2>
        {editing && canWrite ? (
          <form onSubmit={saveDocument}>
            <div className="nx-glass-field">
              <label className="nx-glass-label" htmlFor="doc-title">{t('documents.fields.title')}</label>
              <input id="doc-title" className="nx-glass-input" type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div className="nx-glass-field">
              <label className="nx-glass-label" htmlFor="doc-type">{t('documents.fields.type')}</label>
              <select id="doc-type" className="nx-glass-input" value={editType} onChange={(e) => setEditType(e.target.value)}>
                {DOC_TYPE_CODES.map((code) => <option key={code} value={code}>{typeLabel(code)}</option>)}
              </select>
            </div>
            <div className="nx-glass-field">
              <label className="nx-glass-label" htmlFor="doc-amount">{t('documents.fields.amount')}</label>
              <input id="doc-amount" className="nx-glass-input" type="number" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div className="nx-glass-field">
              <label className="nx-glass-label" htmlFor="doc-currency">{t('documents.fields.currency')}</label>
              <input id="doc-currency" className="nx-glass-input" type="text" value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)} placeholder="ILS" />
            </div>
            <div className="nx-glass-field">
              <label className="nx-glass-label" htmlFor="doc-date">{t('documents.fields.date')}</label>
              <input id="doc-date" className="nx-glass-input" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="nx-glass-toolbar">
              <button type="submit" className="nx-glass-btn nx-glass-btn--purple" disabled={saving}>
                {saving ? t('documents.saving') : t('common.save')}
              </button>
              <button type="button" className="nx-glass-btn nx-glass-btn--secondary" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <>
            {canWrite && !editing && (
              <button type="button" className="nx-glass-btn nx-glass-btn--secondary" onClick={() => setEditing(true)}>
                {t('documents.edit')}
              </button>
            )}
            <dl className="nx-glass-dl" style={{ marginTop: 12 }}>
              <dt>{t('documents.fields.type')}</dt>
              <dd>{typeLabel(doc.document_type_code)}</dd>
              <dt>{t('documents.fields.status')}</dt>
              <dd>{doc.lifecycle_state}</dd>
              <dt>{t('documents.fields.date')}</dt>
              <dd>{doc.document_date ?? doc.issue_date ? new Date(doc.document_date ?? doc.issue_date!).toLocaleDateString() : '—'}</dd>
              <dt>{t('documents.fields.amount')}</dt>
              <dd>{doc.amount_total != null ? `${doc.amount_total} ${doc.currency ?? ''}`.trim() : '—'}</dd>
            </dl>
          </>
        )}
      </section>

      <section className="nx-glass-card">
        <h2>{t('documents.currentVersion')}</h2>
        {versions.find((v) => v.is_current) ? (
          <div className="nx-glass-toolbar" style={{ marginBottom: 0 }}>
            <span>{versions.find((v) => v.is_current)!.original_file_name}</span>
            <button type="button" className="nx-glass-btn nx-glass-btn--secondary" onClick={() => openFile()}>
              {t('documents.open')}
            </button>
          </div>
        ) : (
          <p className="nx-glass-muted">{t('documents.noCurrentVersion')}</p>
        )}
      </section>

      <section className="nx-glass-card">
        <h2>{t('documents.versionHistory')}</h2>
        <ul className="nx-glass-list">
          {versions.map((v) => (
            <li key={v.id}>
              <span>v{v.version_number} — {v.original_file_name}</span>
              {v.is_current && <span className="nx-glass-status--active">{t('documents.current')}</span>}
              <button type="button" className="nx-glass-btn nx-glass-btn--secondary" onClick={() => openFile(v.id)}>
                {t('documents.open')}
              </button>
            </li>
          ))}
        </ul>
        {canWrite && (
          <form onSubmit={uploadNewVersion} className="nx-glass-toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
            <GlassFilePicker
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt,.csv"
              file={newVersionFile}
              disabled={uploadingVersion}
              onChange={setNewVersionFile}
            />
            <button type="submit" className="nx-glass-btn nx-glass-btn--purple" disabled={!newVersionFile || uploadingVersion}>
              {uploadingVersion ? t('documents.uploading') : t('documents.addVersion')}
            </button>
          </form>
        )}
      </section>

      <section className="nx-glass-card">
        <h2>{t('documents.linkedTo')}</h2>
        <ul className="nx-glass-list">
          {links.map((l) => {
            const client = l.target_entity_type === 'client' ? clients.find((c) => c.id === l.target_entity_id) : null;
            return (
              <li key={l.id}>
                <span>{client?.display_name ?? l.target_entity_id}</span>
                {l.is_primary && <span className="nx-glass-status--active">{t('documents.primary')}</span>}
                {canWrite && (
                  <button type="button" className="nx-glass-btn nx-glass-btn--danger" onClick={() => removeLink(l.id)}>
                    {t('documents.remove')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {canWrite && (
          <form onSubmit={addLink} className="nx-glass-toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <select
              className="nx-glass-input nx-glass-input--inline"
              value={linkClientId}
              onChange={(e) => setLinkClientId(e.target.value)}
              aria-label={t('documents.selectClient')}
            >
              <option value="">{t('documents.selectClient')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
            <button type="submit" className="nx-glass-btn nx-glass-btn--purple" disabled={!linkClientId}>
              {t('documents.link')}
            </button>
          </form>
        )}
      </section>

      <section className="nx-glass-card">
        <h2>{t('documents.activity')}</h2>
        <ul className="nx-glass-list">
          {activity.map((a) => (
            <li key={a.id} style={{ display: 'block' }}>
              <strong>{a.event_type}</strong>
              <div className="nx-glass-muted">{new Date(a.created_at).toLocaleString()}</div>
            </li>
          ))}
        </ul>
        {activity.length === 0 && <p className="nx-glass-muted">{t('documents.noActivity')}</p>}
      </section>
    </div>
  );
}

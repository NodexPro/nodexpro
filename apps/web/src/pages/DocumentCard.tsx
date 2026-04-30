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

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  contract: 'Contract',
  statement: 'Statement',
  payroll_document: 'Payroll',
  tax_document: 'Tax',
  other: 'Other',
};

const sectionStyle = { marginBottom: 32, padding: 20, background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb' };

export function DocumentCard() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
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
        if (!cancelled && (e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : 'Failed to load');
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
      setError(e instanceof Error ? e.message : 'Failed to open');
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
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const archiveDocument = async () => {
    if (!orgId || !documentId || !canArchive) return;
    if (!window.confirm('Archive this document? It will be excluded from active lists.')) return;
    setError('');
    try {
      await apiJson(orgDocument(orgId, documentId) + '/archive', { method: 'POST', body: '{}' });
      navigate('/documents');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive');
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
      setError(e instanceof Error ? e.message : 'Failed to add link');
    }
  };

  const removeLink = async (linkId: string) => {
    if (!orgId || !documentId || !canWrite) return;
    setError('');
    try {
      await apiJson(`${orgDocumentLinks(orgId, documentId)}/${linkId}`, { method: 'DELETE' });
      refetchLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove link');
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : '');
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
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
      setError(e instanceof Error ? e.message : 'Failed to upload version');
    } finally {
      setUploadingVersion(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p>Select an organization.</p>;
  if (!documentId) return <p>No document selected.</p>;
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!doc) return <p style={{ padding: 24 }}>Document not found.</p>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => navigate('/documents')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
          ← Documents
        </button>
        <h1 style={{ margin: 0, flex: 1 }}>{doc.title ?? 'Untitled document'}</h1>
        {doc.is_archived && <span style={{ padding: '4px 10px', background: '#f3f4f6', borderRadius: 6, fontSize: 12, color: '#6b7280' }}>Archived</span>}
        {canArchive && !doc.is_archived && (
          <button type="button" onClick={archiveDocument} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}>
            Archive
          </button>
        )}
      </div>

      {error && <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Details</h2>
        {editing && canWrite ? (
          <form onSubmit={saveDocument} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400 }}>
            <label>Title <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ display: 'block', marginTop: 4, padding: '8px 12px', width: '100%', borderRadius: 8, border: '1px solid #d1d5db' }} /></label>
            <label>Type
              <select value={editType} onChange={(e) => setEditType(e.target.value)} style={{ display: 'block', marginTop: 4, padding: '8px 12px', width: '100%', borderRadius: 8, border: '1px solid #d1d5db' }}>
                {Object.entries(DOC_TYPE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
            <label>Amount <input type="number" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} style={{ display: 'block', marginTop: 4, padding: '8px 12px', width: '100%', borderRadius: 8, border: '1px solid #d1d5db' }} /></label>
            <label>Currency <input type="text" value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)} placeholder="ILS" style={{ display: 'block', marginTop: 4, padding: '8px 12px', width: '100%', borderRadius: 8, border: '1px solid #d1d5db' }} /></label>
            <label>Date <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={{ display: 'block', marginTop: 4, padding: '8px 12px', width: '100%', borderRadius: 8, border: '1px solid #d1d5db' }} /></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setEditing(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            {canWrite && !editing && <button type="button" onClick={() => setEditing(true)} style={{ marginBottom: 12, padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Edit</button>}
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 24px' }}>
              <dt style={{ color: '#6b7280' }}>Type</dt>
              <dd style={{ margin: 0 }}>{DOC_TYPE_LABELS[doc.document_type_code] ?? doc.document_type_code}</dd>
              <dt style={{ color: '#6b7280' }}>Status</dt>
              <dd style={{ margin: 0 }}>{doc.lifecycle_state}</dd>
              <dt style={{ color: '#6b7280' }}>Date</dt>
              <dd style={{ margin: 0 }}>{doc.document_date ?? doc.issue_date ? new Date(doc.document_date ?? doc.issue_date!).toLocaleDateString() : '—'}</dd>
              <dt style={{ color: '#6b7280' }}>Amount</dt>
              <dd style={{ margin: 0 }}>{doc.amount_total != null ? `${doc.amount_total} ${doc.currency ?? ''}`.trim() : '—'}</dd>
            </dl>
          </>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Current version</h2>
        {versions.find((v) => v.is_current) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{versions.find((v) => v.is_current)!.original_file_name}</span>
            <button type="button" onClick={() => openFile()} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Open</button>
          </div>
        ) : (
          <p style={{ color: '#6b7280', margin: 0 }}>No current version</p>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Version history</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {versions.map((v) => (
            <li key={v.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>v{v.version_number} — {v.original_file_name}</span>
              {v.is_current && <span style={{ fontSize: 12, color: '#059669' }}>Current</span>}
              <button type="button" onClick={() => openFile(v.id)} style={{ padding: '4px 8px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Open</button>
            </li>
          ))}
        </ul>
        {canWrite && (
          <form onSubmit={uploadNewVersion} style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="file" onChange={(e) => setNewVersionFile(e.target.files?.[0] ?? null)} accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt,.csv" />
            <button type="submit" disabled={!newVersionFile || uploadingVersion} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer' }}>{uploadingVersion ? 'Uploading…' : 'Add version'}</button>
          </form>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Linked to</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {links.map((l) => {
            const client = l.target_entity_type === 'client' ? clients.find((c) => c.id === l.target_entity_id) : null;
            return (
              <li key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{client?.display_name ?? l.target_entity_id}</span>
                {l.is_primary && <span style={{ fontSize: 12, color: '#059669' }}>Primary</span>}
                {canWrite && <button type="button" onClick={() => removeLink(l.id)} style={{ padding: '2px 8px', fontSize: 12, border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer' }}>Remove</button>}
              </li>
            );
          })}
        </ul>
        {canWrite && (
          <form onSubmit={addLink} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <select value={linkClientId} onChange={(e) => setLinkClientId(e.target.value)} style={{ padding: '8px 12px', minWidth: 200, borderRadius: 8, border: '1px solid #d1d5db' }}>
              <option value="">Select client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
            <button type="submit" disabled={!linkClientId} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}>Link</button>
          </form>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Activity</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {activity.map((a) => (
            <li key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
              <strong>{a.event_type}</strong>
              <div style={{ color: '#6b7280', fontSize: 12 }}>{new Date(a.created_at).toLocaleString()}</div>
            </li>
          ))}
        </ul>
        {activity.length === 0 && <p style={{ color: '#6b7280', margin: 0 }}>No activity yet</p>}
      </section>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { orgDocuments, orgDocumentsUpload } from '../api/endpoints';

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

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  contract: 'Contract',
  statement: 'Statement',
  payroll_document: 'Payroll',
  tax_document: 'Tax',
  other: 'Other',
};

export function Documents() {
  const auth = useAuth();
  const navigate = useNavigate();
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
        if (!cancelled && (e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : 'Failed to load');
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
      setError(err instanceof Error ? err.message : 'Failed to upload');
    } finally {
      setUploading(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p>Select an organization.</p>;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Documents</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Document Hub. Upload, classify, and link documents to clients.</p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        {canWrite && (
          <button type="button" onClick={() => setShowUpload(true)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}>
            Upload document
          </button>
        )}
        <select
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
        >
          <option value="">All types</option>
          {Object.entries(DOC_TYPE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived
        </label>
      </div>

      {showUpload && canWrite && (
        <form onSubmit={uploadDocument} style={{ marginBottom: 24, padding: 20, background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <h3 style={{ marginTop: 0 }}>Upload document</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt,.csv" />
            <button type="submit" disabled={!selectedFile || uploading} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" onClick={() => { setShowUpload(false); setSelectedFile(null); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: 12 }}>Title</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Type</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 12 }}>Date</th>
              <th style={{ textAlign: 'right', padding: 12 }}>Amount</th>
              <th style={{ textAlign: 'left', padding: 12 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }} onClick={() => navigate(`/documents/${d.id}`)}>
                <td style={{ padding: 12 }}>{d.title ?? d.document_code ?? '—'}</td>
                <td style={{ padding: 12 }}>{DOC_TYPE_LABELS[d.document_type_code] ?? d.document_type_code}</td>
                <td style={{ padding: 12 }}>{d.lifecycle_state}</td>
                <td style={{ padding: 12 }}>{(d.document_date ?? d.issue_date ?? d.created_at) ? new Date(d.document_date ?? d.issue_date ?? d.created_at!).toLocaleDateString() : '—'}</td>
                <td style={{ padding: 12, textAlign: 'right' }}>{d.amount_total != null ? `${d.amount_total} ${d.currency ?? ''}`.trim() : '—'}</td>
                <td style={{ padding: 12 }}>{d.is_archived && <span style={{ fontSize: 12, color: '#6b7280' }}>Archived</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && list.length === 0 && <p style={{ color: '#6b7280' }}>No documents yet. Upload one to get started.</p>}
    </div>
  );
}

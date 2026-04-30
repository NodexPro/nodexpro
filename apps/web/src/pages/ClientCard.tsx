import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson, apiFetch } from '../api/client';
import {
  orgClientFull,
  orgClient,
  orgClientContacts,
  orgClientContact,
  orgClientNotes,
  orgClientNote,
  orgClientRestore,
  orgClientTags,
  orgClientTimeline,
  orgClientFiles,
  orgClientFileOpen,
  orgClientFileRemove,
  orgTags,
} from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import {
  ClientCardSection,
  ClientCardSectionTitle,
  ClientCardFieldGrid,
  ClientCardField,
  ClientCardFieldMono,
  ClientCardFormField,
  clientCardInputStyle,
  ClientCardHint,
  ClientCardToolbarRow,
  ClientCardTableShell,
  clientCardContactGridColumns,
  ClientCardContactColumnHeader,
  ClientCardContactValueCell,
  ClientCardContactFormColumn,
  ClientCardContactActionsCell,
  clientCardContactInputStyle,
  clientCardContactInputFocusProps,
  clientCardFormStackStyle,
  clientCardSubsectionTitleStyle,
} from '../components/client-card/ClientCardSectionUi';

interface Client {
  id: string;
  display_name: string;
  legal_name?: string | null;
  tax_id?: string;
  client_type: string;
  status: string;
  lifecycle_state: string;
  is_archived: boolean;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  country_code?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  is_primary: boolean;
  status: string;
}

type ContactDisplayRow = Contact & { isClientProfileRow?: boolean };

interface Note {
  id: string;
  note_text: string;
  visibility_scope: string;
  is_sensitive: boolean;
  created_at: string;
  updated_at?: string;
}

interface Tag {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
}

interface TimelineEvent {
  id: string;
  event_type: string;
  source_type: string;
  created_at: string;
  payload_json: Record<string, unknown> | null;
}

interface FileLink {
  id: string;
  file_asset_id: string;
  file_name: string;
  created_at: string;
}

interface DocSummary {
  id: string;
  title: string | null;
  document_type_code: string;
  lifecycle_state: string;
}

export function ClientCard() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const { t } = useI18n();
  const [client, setClient] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [files, setFiles] = useState<FileLink[]>([]);
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contactMode, setContactMode] = useState<'view' | 'add' | 'edit'>('view');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactFormName, setContactFormName] = useState('');
  const [contactFormPhone, setContactFormPhone] = useState('');
  const [contactFormEmail, setContactFormEmail] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [tagToAdd, setTagToAdd] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editLifecycle, setEditLifecycle] = useState('');
  const [editType, setEditType] = useState('business_customer');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editStreet, setEditStreet] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [refreshTagOptionsTrigger, setRefreshTagOptionsTrigger] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const canWrite = auth.status === 'authenticated' && auth.me?.permissions?.includes('clients:write');
  const canArchive = auth.status === 'authenticated' && auth.me?.permissions?.includes('clients:archive');

  useEffect(() => {
    if (!orgId || !clientId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    apiJson<{ client: Client; contacts: Contact[]; notes: Note[]; tags: Tag[]; timeline: TimelineEvent[]; files: FileLink[]; documents?: DocSummary[] }>(orgClientFull(orgId, clientId), { signal: ac.signal })
      .then((data) => {
        if (cancelled) return;
        setClient(data.client as Client);
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        setNotes(Array.isArray(data.notes) ? data.notes : []);
        setTags(Array.isArray(data.tags) ? data.tags : []);
        setTimeline(Array.isArray(data.timeline) ? data.timeline : []);
        setFiles(Array.isArray(data.files) ? data.files : []);
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
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
  }, [orgId, clientId]);

  const openAddContact = () => {
    if (!canWrite) return;
    setContactMode('add');
    setEditingContactId(null);
    setContactFormName('');
    setContactFormPhone('');
    setContactFormEmail('');
  };

  const openEditContact = (c: Contact) => {
    if (!canWrite) return;
    setContactMode('edit');
    setEditingContactId(c.id);
    setContactFormName(c.full_name);
    setContactFormPhone(c.phone ?? '');
    setContactFormEmail(c.email ?? '');
  };

  const cancelContactForm = () => {
    setContactMode('view');
    setEditingContactId(null);
    setContactFormName('');
    setContactFormPhone('');
    setContactFormEmail('');
  };

  const saveContact = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !clientId || !canWrite) return;
    setError('');
    try {
      const body = {
        full_name: contactFormName,
        phone: contactFormPhone || null,
        email: contactFormEmail || null,
      };

      if (contactMode === 'add') {
        await apiJson(orgClientContacts(orgId, clientId), {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } else if (contactMode === 'edit' && editingContactId) {
        await apiJson(orgClientContact(orgId, clientId, editingContactId), {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        return;
      }

      const next = await apiJson<Contact[]>(orgClientContacts(orgId, clientId));
      setContacts(Array.isArray(next) ? next : []);
      cancelContactForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save contact');
    }
  };

  const deleteContact = async (contactId: string) => {
    if (!orgId || !clientId || !canWrite) return;
    setError('');
    try {
      await apiFetch(orgClientContact(orgId, clientId, contactId), { method: 'DELETE' });
      const next = await apiJson<Contact[]>(orgClientContacts(orgId, clientId));
      setContacts(Array.isArray(next) ? next : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete contact');
    }
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !clientId || !newNoteText.trim() || !canWrite) return;
    setError('');
    try {
      await apiJson(orgClientNotes(orgId, clientId), { method: 'POST', body: JSON.stringify({ note_text: newNoteText.trim() }) });
      setNewNoteText('');
      const next = await apiJson<Note[]>(orgClientNotes(orgId, clientId));
      setNotes(Array.isArray(next) ? next : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add note');
    }
  };

  const addTag = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !clientId || !tagToAdd || !canWrite) return;
    setError('');
    try {
      await apiJson(orgClientTags(orgId, clientId), { method: 'POST', body: JSON.stringify({ tagId: tagToAdd }) });
      setTagToAdd('');
      const nextTags = await apiJson<Tag[]>(orgClientTags(orgId, clientId));
      setTags(Array.isArray(nextTags) ? nextTags : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add tag');
    }
  };

  const startEdit = () => {
    if (client) {
      setEditName(client.display_name);
      setEditTaxId(client.tax_id ?? '');
      setEditStatus(client.status);
      setEditLifecycle(client.lifecycle_state);
      setEditType(client.client_type);
      setEditPhone(client.phone ?? '');
      setEditEmail(client.email ?? '');
      setEditWebsite(client.website ?? '');
      setEditCountry(client.country_code ?? '');
      setEditCity(client.city ?? '');
      setEditStreet(client.address ?? '');
      setEditPostalCode(client.postal_code ?? '');
      setEditing(true);
    }
  };

  const saveClient = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !clientId || !canWrite) return;
    setSaving(true);
    setError('');
    try {
      const updated = await apiJson<Client>(orgClient(orgId, clientId), {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: editName.trim(),
          tax_id: editTaxId.trim() || undefined,
          status: editStatus,
          lifecycle_state: editLifecycle,
          client_type: editType,
          phone: editPhone.trim() || null,
          email: editEmail.trim() || null,
          website: editWebsite.trim() || null,
          country_code: editCountry.trim().slice(0, 2) || null,
          city: editCity.trim() || null,
          street: editStreet.trim() || null,
          postal_code: editPostalCode.trim() || null,
        }),
      });
      setClient(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const archiveClient = async () => {
    if (!orgId || !clientId || !canArchive) return;
    if (!window.confirm('Archive this client? They will be excluded from active lists.')) return;
    try {
      await apiJson(orgClient(orgId, clientId) + '/archive', { method: 'POST', body: '{}' });
      navigate('/clients');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive');
    }
  };

  const restoreClient = async () => {
    if (!orgId || !clientId || !canArchive) return;
    setRestoring(true);
    setError('');
    try {
      const updated = await apiJson<Client>(orgClientRestore(orgId, clientId), { method: 'POST', body: '{}' });
      setClient(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restore');
    } finally {
      setRestoring(false);
    }
  };

  const startEditNote = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingNoteText(note.note_text);
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteText('');
  };

  const deleteNote = async (noteId: string) => {
    if (!orgId || !clientId || !canWrite) return;
    if (!window.confirm(t('clients.notes.deleteConfirm'))) return;
    setDeletingNoteId(noteId);
    setError('');
    try {
      const delRes = await apiFetch(orgClientNote(orgId, clientId, noteId), { method: 'DELETE' });
      if (!delRes.ok) {
        const body = await delRes.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? delRes.statusText);
      }
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      const [nextTimeline] = await Promise.all([
        apiJson<TimelineEvent[]>(orgClientTimeline(orgId, clientId)),
      ]);
      setTimeline(Array.isArray(nextTimeline) ? nextTimeline : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete note');
    } finally {
      setDeletingNoteId(null);
    }
  };

  const saveNote = async (e: FormEvent, noteId: string) => {
    e.preventDefault();
    if (!orgId || !clientId || !canWrite) return;
    setSavingNote(true);
    setError('');
    try {
      await apiJson(orgClientNote(orgId, clientId, noteId), {
        method: 'PATCH',
        body: JSON.stringify({ note_text: editingNoteText.trim() }),
      });
      const [nextNotes, nextTimeline] = await Promise.all([
        apiJson<Note[]>(orgClientNotes(orgId, clientId)),
        apiJson<TimelineEvent[]>(orgClientTimeline(orgId, clientId)),
      ]);
      setNotes(Array.isArray(nextNotes) ? nextNotes : []);
      setTimeline(Array.isArray(nextTimeline) ? nextTimeline : []);
      setEditingNoteId(null);
      setEditingNoteText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update note');
    } finally {
      setSavingNote(false);
    }
  };

  const removeFile = async (fileAssetId: string) => {
    if (!orgId || !clientId || !canWrite) return;
    if (!window.confirm('Remove this file from the client? The file will no longer appear here but is not deleted.')) return;
    setRemovingFileId(fileAssetId);
    setError('');
    try {
      await apiJson<void>(orgClientFileRemove(orgId, clientId, fileAssetId), { method: 'DELETE' });
      const next = await apiJson<FileLink[]>(orgClientFiles(orgId, clientId));
      setFiles(Array.isArray(next) ? next : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove file');
    } finally {
      setRemovingFileId(null);
    }
  };

  const removeTag = async (tagId: string) => {
    if (!orgId || !clientId || !canWrite) return;
    setError('');
    try {
      await apiJson<void>(`${orgClientTags(orgId, clientId)}/${tagId}`, { method: 'DELETE' });
      setTags((prev) => prev.filter((tag) => tag.id !== tagId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove tag');
    }
  };

  const createTag = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !newTagName.trim() || !canWrite) return;
    setError('');
    try {
      await apiJson(orgTags(orgId), { method: 'POST', body: JSON.stringify({ name: newTagName.trim() }) });
      setNewTagName('');
      setRefreshTagOptionsTrigger((prev) => prev + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tag');
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

  const attachFile = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !clientId || !canWrite || !selectedFile) return;
    if (files.length >= 2) {
      setError(t('clients.files.maxReached'));
      return;
    }
    setAttaching(true);
    setError('');
    try {
      const fileBase64 = await fileToBase64(selectedFile);
      await apiJson(orgClientFiles(orgId, clientId), {
        method: 'POST',
        body: JSON.stringify({
          file_name: selectedFile.name,
          mime_type: selectedFile.type || null,
          file_size: selectedFile.size,
          file_base64: fileBase64,
        }),
      });
      setSelectedFile(null);
      const next = await apiJson<FileLink[]>(orgClientFiles(orgId, clientId));
      setFiles(Array.isArray(next) ? next : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to attach file');
    } finally {
      setAttaching(false);
    }
  };

  const openFile = async (fileAssetId: string) => {
    if (!orgId || !clientId) return;
    setError('');
    try {
      const { url } = await apiJson<{ url: string }>(orgClientFileOpen(orgId, clientId, fileAssetId));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('clients.files.accessDenied'));
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p>{t('topBar.selectOrg')}</p>;
  if (!clientId) return <p>No client selected.</p>;

  if (loading) return <p style={{ padding: 24 }}>{t('common.loading')}</p>;
  if (!client) return <p style={{ padding: 24 }}>Client not found.</p>;

  const clientPhoneTrim = (client.phone ?? '').trim();
  const clientEmailNorm = (client.email ?? '').trim().toLowerCase();
  const hasProfileContactFields = !!(clientPhoneTrim || clientEmailNorm);
  const profileContactMatchedInList =
    !hasProfileContactFields ||
    contacts.some((c) => {
      const cp = (c.phone ?? '').trim();
      const ce = (c.email ?? '').trim().toLowerCase();
      const phoneOk = !clientPhoneTrim || cp === clientPhoneTrim;
      const emailOk = !clientEmailNorm || ce === clientEmailNorm;
      return phoneOk && emailOk;
    });
  const showClientProfileContactRow = hasProfileContactFields && !profileContactMatchedInList;
  const contactDisplayRows: ContactDisplayRow[] = showClientProfileContactRow
    ? [
        {
          id: '__client_profile__',
          full_name: client.display_name,
          phone: clientPhoneTrim || null,
          email: (client.email ?? '').trim() || null,
          title: null,
          is_primary: true,
          status: 'active',
          isClientProfileRow: true,
        },
        ...contacts,
      ]
    : [...contacts];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => navigate('/clients')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
          ← {t('clients.title')}
        </button>
        <h1 style={{ margin: 0, flex: 1 }}>{client.display_name}</h1>
        {client.is_archived && <span style={{ padding: '4px 10px', background: '#f3f4f6', borderRadius: 6, fontSize: 12, color: '#6b7280' }}>{t('common.archived')}</span>}
        {canArchive && !client.is_archived && (
          <button type="button" onClick={archiveClient} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}>
            {t('clients.actions.archive')}
          </button>
        )}
        {canArchive && client.is_archived && (
          <button type="button" onClick={restoreClient} disabled={restoring} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#15803d', cursor: 'pointer' }}>
            {restoring ? t('common.loading') : t('clients.actions.restore')}
          </button>
        )}
      </div>

      {error && <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      <ClientCardSection>
        <ClientCardSectionTitle>{t('clients.details.section')}</ClientCardSectionTitle>
        {editing && canWrite ? (
          <form onSubmit={saveClient} style={clientCardFormStackStyle}>
            <ClientCardFormField label={t('clients.create.displayName')}>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required style={clientCardInputStyle} />
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.details.taxId')}>
              <input type="text" value={editTaxId} onChange={(e) => setEditTaxId(e.target.value)} required style={{ ...clientCardInputStyle, fontFamily: 'monospace' }} />
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.details.status')}>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={clientCardInputStyle}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="pending">pending</option>
              </select>
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.details.lifecycle')}>
              <select value={editLifecycle} onChange={(e) => setEditLifecycle(e.target.value)} style={clientCardInputStyle}>
                <option value="lead">lead</option>
                <option value="prospect">prospect</option>
                <option value="customer">customer</option>
                <option value="churned">churned</option>
                <option value="archived">archived</option>
              </select>
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.details.type')}>
              <select value={editType} onChange={(e) => setEditType(e.target.value)} style={clientCardInputStyle}>
                <option value="business_customer">{t('clients.type.business_customer')}</option>
                <option value="individual_customer">{t('clients.type.individual_customer')}</option>
                <option value="supplier">{t('clients.type.supplier')}</option>
                <option value="partner">{t('clients.type.partner')}</option>
                <option value="other">{t('clients.type.other')}</option>
              </select>
            </ClientCardFormField>
            <h3 style={clientCardSubsectionTitleStyle}>{t('clients.contact.section')}</h3>
            <ClientCardFormField label={t('clients.details.phone')}>
              <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={t('clients.contact.phonePlaceholder')} style={clientCardInputStyle} />
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.details.email')}>
              <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder={t('clients.contact.emailPlaceholder')} style={clientCardInputStyle} />
            </ClientCardFormField>
            <ClientCardHint>{t('clients.contact.requiredHint')}</ClientCardHint>
            <ClientCardFormField label={t('clients.contact.website')}>
              <input type="url" value={editWebsite} onChange={(e) => setEditWebsite(e.target.value)} placeholder="https://" style={clientCardInputStyle} />
            </ClientCardFormField>
            <h3 style={clientCardSubsectionTitleStyle}>{t('clients.address.section')}</h3>
            <ClientCardFormField label={t('clients.address.country')}>
              <input type="text" value={editCountry} onChange={(e) => setEditCountry(e.target.value)} placeholder="IL" maxLength={2} style={clientCardInputStyle} />
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.address.city')}>
              <input type="text" value={editCity} onChange={(e) => setEditCity(e.target.value)} style={clientCardInputStyle} />
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.address.street')}>
              <input type="text" value={editStreet} onChange={(e) => setEditStreet(e.target.value)} style={clientCardInputStyle} />
            </ClientCardFormField>
            <ClientCardFormField label={t('clients.address.postalCode')}>
              <input type="text" value={editPostalCode} onChange={(e) => setEditPostalCode(e.target.value)} style={clientCardInputStyle} />
            </ClientCardFormField>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}>
                {saving ? t('common.loading') : t('common.save')}
              </button>
              <button type="button" onClick={() => setEditing(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <>
            {canWrite && !editing && (
              <button type="button" onClick={startEdit} style={{ marginBottom: 12, padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
                {t('clients.actions.edit')}
              </button>
            )}
            <ClientCardFieldGrid>
              <ClientCardField label={t('clients.details.status')}>{client.status}</ClientCardField>
              <ClientCardField label={t('clients.details.lifecycle')}>{client.lifecycle_state}</ClientCardField>
              <ClientCardField label={t('clients.details.type')}>{t(`clients.type.${client.client_type}`)}</ClientCardField>
              {client.tax_id != null && <ClientCardFieldMono label={t('clients.details.taxId')}>{client.tax_id}</ClientCardFieldMono>}
              {client.legal_name && <ClientCardField label={t('clients.details.legalName')}>{client.legal_name}</ClientCardField>}
            </ClientCardFieldGrid>
          </>
        )}
      </ClientCardSection>

      <ClientCardSection>
        <ClientCardSectionTitle>{t('clients.contact.section')}</ClientCardSectionTitle>
        <ClientCardToolbarRow>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: 0 }}>
            {t('clients.contacts.section')} ({contacts.length}/3)
          </span>
          {canWrite && contactMode === 'view' && (
            <button
              type="button"
              onClick={openAddContact}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f9fafb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#ffffff';
              }}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#ffffff',
                fontSize: 13,
                color: '#111827',
                cursor: 'pointer',
              }}
            >
              {t('clients.contacts.add')}
            </button>
          )}
        </ClientCardToolbarRow>

        <ClientCardTableShell>
          <div style={{ ...clientCardContactGridColumns, borderBottom: '1px solid #f3f4f6' }}>
            <ClientCardContactColumnHeader>Name</ClientCardContactColumnHeader>
            <ClientCardContactColumnHeader>Phone</ClientCardContactColumnHeader>
            <ClientCardContactColumnHeader>Email</ClientCardContactColumnHeader>
            <ClientCardContactColumnHeader style={{ textAlign: 'right', justifySelf: 'end', minWidth: 148 }}>
              Actions
            </ClientCardContactColumnHeader>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {contactDisplayRows.length === 0 && contactMode !== 'add' && (
              <li
                style={{
                  padding: '12px 0',
                  fontSize: 14,
                  fontWeight: 400,
                  color: '#6b7280',
                }}
              >
                {t('clients.contact.empty')}
              </li>
            )}
            {contactDisplayRows.map((c, rowIndex) => {
              const isProfileRow = c.isClientProfileRow === true;
              const isEditing = !isProfileRow && contactMode === 'edit' && editingContactId === c.id;
              const isPrimary = rowIndex === 0;
              const showRowRule =
                rowIndex < contactDisplayRows.length - 1 || (contactMode === 'add' && canWrite);
              const rowBorder = showRowRule ? '1px solid #f3f4f6' : 'none';

              if (isEditing) {
                return (
                  <li
                    key={c.id}
                    style={{
                      borderBottom: rowBorder,
                      listStyle: 'none',
                    }}
                  >
                    <form
                      onSubmit={saveContact}
                      style={{
                        ...clientCardContactGridColumns,
                        columnGap: 20,
                        alignItems: 'start',
                        width: '100%',
                      }}
                    >
                      <ClientCardContactFormColumn label="Name">
                        <input
                          type="text"
                          value={contactFormName}
                          onChange={(e) => setContactFormName(e.target.value)}
                          placeholder={t('clients.contacts.fullNamePlaceholder')}
                          style={clientCardContactInputStyle}
                          {...clientCardContactInputFocusProps}
                        />
                      </ClientCardContactFormColumn>
                      <ClientCardContactFormColumn label="Phone">
                        <input
                          type="text"
                          value={contactFormPhone}
                          onChange={(e) => setContactFormPhone(e.target.value)}
                          placeholder={t('clients.details.phone')}
                          style={clientCardContactInputStyle}
                          {...clientCardContactInputFocusProps}
                        />
                      </ClientCardContactFormColumn>
                      <ClientCardContactFormColumn label="Email">
                        <input
                          type="email"
                          value={contactFormEmail}
                          onChange={(e) => setContactFormEmail(e.target.value)}
                          placeholder={t('clients.details.email')}
                          style={clientCardContactInputStyle}
                          {...clientCardContactInputFocusProps}
                        />
                      </ClientCardContactFormColumn>
                      <ClientCardContactActionsCell>
                        <button
                          type="submit"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#047857';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#059669';
                          }}
                          style={{
                            height: 30,
                            padding: '0 12px',
                            borderRadius: 6,
                            border: 'none',
                            background: '#059669',
                            color: '#ffffff',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          {t('common.save')}
                        </button>
                        <button
                          type="button"
                          onClick={cancelContactForm}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#f9fafb';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#ffffff';
                          }}
                          style={{
                            height: 30,
                            padding: '0 12px',
                            borderRadius: 6,
                            border: '1px solid #d1d5db',
                            background: '#ffffff',
                            color: '#111827',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          {t('common.cancel')}
                        </button>
                      </ClientCardContactActionsCell>
                    </form>
                  </li>
                );
              }

              return (
                <li
                  key={c.id}
                  style={{
                    borderBottom: rowBorder,
                    ...clientCardContactGridColumns,
                    columnGap: 20,
                    alignItems: 'start',
                  }}
                >
                  <ClientCardContactValueCell>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: isPrimary ? 500 : 400 }}>{c.full_name}</span>
                      {isPrimary && <span style={{ fontSize: 11, fontWeight: 400, color: '#6b7280' }}>(Primary)</span>}
                    </div>
                  </ClientCardContactValueCell>
                  <ClientCardContactValueCell>{c.phone || ''}</ClientCardContactValueCell>
                  <ClientCardContactValueCell>{c.email || ''}</ClientCardContactValueCell>
                  {canWrite && !isProfileRow ? (
                    <ClientCardContactActionsCell>
                      <button
                        type="button"
                        onClick={() => openEditContact(c)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f9fafb';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#ffffff';
                        }}
                        style={{
                          height: 30,
                          padding: '0 10px',
                          borderRadius: 6,
                          border: '1px solid #d1d5db',
                          background: '#ffffff',
                          color: '#111827',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteContact(c.id)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#fee2e2';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#fef2f2';
                        }}
                        style={{
                          height: 30,
                          padding: '0 10px',
                          borderRadius: 6,
                          border: 'none',
                          background: '#fef2f2',
                          color: '#b91c1c',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </ClientCardContactActionsCell>
                  ) : (
                    <div style={{ minWidth: 148 }} />
                  )}
                </li>
              );
            })}
          </ul>

          {contactMode === 'add' && canWrite && (
            <div
              style={{
                padding: '12px 0',
                borderTop: contacts.length > 0 || showClientProfileContactRow ? '1px solid #f3f4f6' : 'none',
              }}
            >
              <form
                onSubmit={saveContact}
                style={{
                  ...clientCardContactGridColumns,
                  columnGap: 20,
                  alignItems: 'start',
                  width: '100%',
                }}
              >
                <ClientCardContactFormColumn label="Name">
                  <input
                    type="text"
                    value={contactFormName}
                    onChange={(e) => setContactFormName(e.target.value)}
                    placeholder={t('clients.contacts.fullNamePlaceholder')}
                    style={clientCardContactInputStyle}
                    {...clientCardContactInputFocusProps}
                  />
                </ClientCardContactFormColumn>
                <ClientCardContactFormColumn label="Phone">
                  <input
                    type="text"
                    value={contactFormPhone}
                    onChange={(e) => setContactFormPhone(e.target.value)}
                    placeholder={t('clients.details.phone')}
                    style={clientCardContactInputStyle}
                    {...clientCardContactInputFocusProps}
                  />
                </ClientCardContactFormColumn>
                <ClientCardContactFormColumn label="Email">
                  <input
                    type="email"
                    value={contactFormEmail}
                    onChange={(e) => setContactFormEmail(e.target.value)}
                    placeholder={t('clients.details.email')}
                    style={clientCardContactInputStyle}
                    {...clientCardContactInputFocusProps}
                  />
                </ClientCardContactFormColumn>
                <ClientCardContactActionsCell>
                  <button
                    type="submit"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#047857';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#059669';
                    }}
                    style={{
                      height: 30,
                      padding: '0 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#059669',
                      color: '#ffffff',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={cancelContactForm}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f9fafb';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#ffffff';
                    }}
                    style={{
                      height: 30,
                      padding: '0 12px',
                      borderRadius: 6,
                      border: '1px solid #d1d5db',
                      background: '#ffffff',
                      color: '#111827',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </ClientCardContactActionsCell>
              </form>
            </div>
          )}
      </ClientCardTableShell>
      </ClientCardSection>

      <ClientCardSection>
        <ClientCardSectionTitle>{t('clients.address.section')}</ClientCardSectionTitle>
        {(!client.country_code || client.country_code === '') &&
        (!client.city || client.city === '') &&
        (!client.address || client.address === '') &&
        (!client.postal_code || client.postal_code === '') ? (
          <div style={{ fontSize: 14, color: '#6b7280' }}>{t('clients.address.empty')}</div>
        ) : (
          <ClientCardFieldGrid>
            {(client.country_code != null && client.country_code !== '') && (
              <ClientCardField label={t('clients.address.country')}>{client.country_code}</ClientCardField>
            )}
            {(client.city != null && client.city !== '') && <ClientCardField label={t('clients.address.city')}>{client.city}</ClientCardField>}
            {(client.address != null && client.address !== '') && <ClientCardField label={t('clients.address.street')}>{client.address}</ClientCardField>}
            {(client.postal_code != null && client.postal_code !== '') && (
              <ClientCardField label={t('clients.address.postalCode')}>{client.postal_code}</ClientCardField>
            )}
          </ClientCardFieldGrid>
        )}
      </ClientCardSection>

      {/* Additional contacts are now managed via modal in the Contact section; old bottom Contacts block removed */}

      <ClientCardSection>
        <ClientCardSectionTitle>{t('clients.notes.section')}</ClientCardSectionTitle>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>Add notes below. You can edit existing notes with the Edit button.</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
          {notes.map((n) => {
            const isMaskedSensitive = n.is_sensitive && n.note_text === '[Sensitive]';
            const canEditThisNote = canWrite && !isMaskedSensitive;
            return (
              <li key={n.id} style={{ padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
                {editingNoteId === n.id && canWrite ? (
                  <form onSubmit={(e) => saveNote(e, n.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea
                      value={editingNoteText}
                      onChange={(e) => setEditingNoteText(e.target.value)}
                      rows={3}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="submit" disabled={savingNote} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                        {savingNote ? t('common.loading') : t('common.save')}
                      </button>
                      <button type="button" onClick={cancelEditNote} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{n.note_text}</div>
                        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                          {new Date(n.created_at).toLocaleString()}
                          {n.updated_at && n.updated_at !== n.created_at && ` · ${t('clients.notes.edited')} ${new Date(n.updated_at).toLocaleString()}`}
                        </div>
                        {n.is_sensitive && <span style={{ display: 'inline-block', fontSize: 12, color: '#b45309', marginTop: 4 }}>{t('clients.notes.sensitive')}</span>}
                      </div>
                      {canWrite && (
                        <div style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
                          {canEditThisNote && (
                            <button
                              type="button"
                              onClick={() => startEditNote(n)}
                              style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}
                            >
                              {t('clients.actions.edit')}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={deletingNoteId === n.id}
                            onClick={() => deleteNote(n.id)}
                            style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
                          >
                            {deletingNoteId === n.id ? t('common.loading') : t('clients.notes.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {canWrite && (
          <form onSubmit={addNote} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              placeholder={t('clients.notes.placeholder')}
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              rows={3}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', resize: 'vertical' }}
            />
            <button type="submit" style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', alignSelf: 'flex-start' }}>
              {t('clients.notes.add')}
            </button>
          </form>
        )}
      </ClientCardSection>

      <ClientCardSection>
        <ClientCardSectionTitle>{t('clients.tags.section')}</ClientCardSectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {tags.map((tag) => (
            <span key={tag.id} style={{ padding: '4px 12px', background: '#e5e7eb', borderRadius: 6, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {tag.name}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => removeTag(tag.id)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#6b7280' }}
                  aria-label={t('clients.tags.remove')}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {canWrite && (
          <>
            <form onSubmit={addTag} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <TagSelect orgId={orgId} value={tagToAdd} onChange={setTagToAdd} refreshTrigger={refreshTagOptionsTrigger} />
              <button type="submit" style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}>
                {t('clients.tags.add')}
              </button>
            </form>
            <form onSubmit={createTag} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder={t('clients.tags.newTagPlaceholder')}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', flex: 1, maxWidth: 220 }}
              />
              <button type="submit" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer' }}>
                {t('clients.tags.createTag')}
              </button>
            </form>
          </>
        )}
      </ClientCardSection>

      <ClientCardSection>
        <ClientCardSectionTitle>{t('clients.files.section')}</ClientCardSectionTitle>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {files.map((f) => (
            <li key={f.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>{f.file_name ?? f.file_asset_id}</span>
              <button
                type="button"
                onClick={() => openFile(f.file_asset_id)}
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
              >
                {t('clients.files.open')}
              </button>
              {canWrite && (
                <button
                  type="button"
                  disabled={removingFileId === f.file_asset_id}
                  onClick={() => removeFile(f.file_asset_id)}
                  style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
                >
                  {removingFileId === f.file_asset_id ? t('common.loading') : t('clients.files.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
          <form onSubmit={attachFile} style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="file"
              onChange={(e) => setSelectedFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
              style={{ maxWidth: 260 }}
            />
            <button
              type="submit"
              disabled={!selectedFile || attaching || files.length >= 2}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer' }}
            >
              {attaching ? t('common.loading') : t('clients.files.attach')}
            </button>
            {files.length >= 2 && <span style={{ fontSize: 12, color: '#b91c1c' }}>{t('clients.files.maxReached')}</span>}
          </form>
        )}
        {files.length === 0 && <p style={{ color: '#6b7280', margin: 0 }}>{t('clients.files.noFiles')}</p>}
      </ClientCardSection>

      {auth.me?.permissions?.includes('documents:read') && (
      <ClientCardSection>
        <ClientCardSectionTitle>Documents</ClientCardSectionTitle>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {documents.map((d) => (
            <li key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
              <button type="button" onClick={() => navigate(`/documents/${d.id}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: '#059669', textDecoration: 'underline' }}>
                {d.title ?? 'Untitled'} — {d.document_type_code}
              </button>
            </li>
          ))}
        </ul>
        {documents.length === 0 && <p style={{ color: '#6b7280', margin: 0 }}>No documents linked to this client.</p>}
      </ClientCardSection>
      )}

      <ClientCardSection>
        <ClientCardSectionTitle>{t('clients.activity.section')}</ClientCardSectionTitle>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {timeline.map((ev) => (
            <li key={ev.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 14 }}>
              <strong>{ev.event_type}</strong>
              <div style={{ color: '#6b7280', fontSize: 12 }}>{new Date(ev.created_at).toLocaleString()}</div>
            </li>
          ))}
        </ul>
        {timeline.length === 0 && <p style={{ color: '#6b7280', margin: 0 }}>{t('clients.activity.none')}</p>}
      </ClientCardSection>

    </div>
  );
}

function TagSelect({ orgId, value, onChange, refreshTrigger = 0 }: { orgId: string; value: string; onChange: (v: string) => void; refreshTrigger?: number }) {
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!orgId) return;
    apiJson<{ id: string; name: string }[]>(orgTags(orgId))
      .then((list) => setOptions(Array.isArray(list) ? list : []))
      .catch(() => setOptions([]));
  }, [orgId, refreshTrigger]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '8px 12px', minWidth: 180, borderRadius: 8, border: '1px solid #d1d5db' }}>
      <option value="">Choose tag…</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}

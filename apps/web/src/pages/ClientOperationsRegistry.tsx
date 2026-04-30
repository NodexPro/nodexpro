import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, apiJson } from '../api/client';
import {
  moduleClientOperationsRegistry,
  moduleClientOperationsCase,
  moduleClientOperationsNoteTypes,
  moduleClientOperationsOperationalNotes,
  moduleClientOperationsOperationalNote,
} from '../api/endpoints';
import { PageHeader } from '../templates/template-1/components/PageHeader';
import { SectionCard } from '../templates/template-1/components/SectionCard';
import { ClientNoteModal } from '../components/ClientNoteModal';
import {
  ClientWorkspaceModal,
  buildPlaceholderClientCaseFromRegistryRow,
  type ClientOperationsCaseResponse,
} from '../components/ClientWorkspacePanel';
import '../styles/nx-modal.css';

type ClientOperationsRegistryRow = {
  client_id: string;
  client_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  payroll_flag: boolean | null;
  material_brought_flag: boolean | null;
  vat_status: string | null;
  income_tax_advance_status: string | null;
  national_insurance_status: string | null;
  national_insurance_deductions_status: string | null;
  income_tax_deductions_status: string | null;
  assigned_handler_user_id: string | null;
  notes_cell_text_he: string | null;
  operational_notes_count: number;
  vat_due_registry_display_he: string | null;
};

type NoteTypeRow = { code: string; label_he: string; sort_order: number; allows_reminder: boolean };
type OperationalNoteRow = {
  id: string;
  type_code: string;
  type_label_he: string;
  body: string;
  reminder_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConflictPayload = {
  code: string;
  ui: { title_he: string; message_he: string; button_create_anyway_he: string; button_change_time_he: string };
  conflicts: Array<{
    client_display_name: string | null;
    body_preview: string;
    type_label_he: string;
    reminder_at: string;
  }>;
};

function renderCell(v: unknown): string {
  if (v === true) return 'כן';
  if (v === false) return 'לא';
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/** סכום חודשי בביטוח לאומי — מציג ₪ אחרי המספר (גם לערכי פרופיל ישנים בלי סימן). */
function renderNationalInsuranceCell(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v).trim();
  if (s.includes('₪')) return s;
  if (s === 'לא עונה להגדרות') return s;
  // מספר מעוצב (he-IL) או מספר גולמי
  if (/^[\d\u00A0\s,\u2009\u202F.]+$/.test(s)) {
    return `${s}\u00A0₪`;
  }
  return s;
}

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string | null {
  if (!local || !local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ClientOperationsRegistry() {
  const auth = useAuth();
  const canEdit = auth.status === 'authenticated' && auth.me.permissions.includes('client_operations.edit');

  const [rows, setRows] = useState<ClientOperationsRegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [noteTypes, setNoteTypes] = useState<NoteTypeRow[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalData, setModalData] = useState<ClientOperationsCaseResponse | null>(null);

  const [notesModalClientId, setNotesModalClientId] = useState<string | null>(null);
  const [notesModalClientName, setNotesModalClientName] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState('');
  const [operationalNotes, setOperationalNotes] = useState<OperationalNoteRow[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [formTypeCode, setFormTypeCode] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formReminderLocal, setFormReminderLocal] = useState('');
  const [, setFormSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictPayload | null>(null);

  const reloadRegistry = useCallback(() => {
    apiJson<{ rows: ClientOperationsRegistryRow[] }>(moduleClientOperationsRegistry())
      .then((data) => setRows(Array.isArray(data?.rows) ? data.rows : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');

    const opts = { signal: ac.signal };

    Promise.all([
      apiJson<{ rows: ClientOperationsRegistryRow[] }>(moduleClientOperationsRegistry(), opts),
      apiJson<{ types: NoteTypeRow[] }>(moduleClientOperationsNoteTypes(), opts),
    ])
      .then(([reg, nt]) => {
        if (!cancelled) {
          setRows(Array.isArray(reg?.rows) ? reg.rows : []);
          setNoteTypes(Array.isArray(nt?.types) ? nt.types : []);
          const first = nt.types?.[0]?.code ?? '';
          if (first) setFormTypeCode(first);
        }
      })
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [auth.status]);

  useEffect(() => {
    if (!notesModalClientId) return;
    setNotesLoading(true);
    setNotesError('');
    apiJson<{ notes: OperationalNoteRow[] }>(moduleClientOperationsOperationalNotes(notesModalClientId))
      .then((d) => setOperationalNotes(Array.isArray(d?.notes) ? d.notes : []))
      .catch((e) => setNotesError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setNotesLoading(false));
  }, [notesModalClientId]);

  if (auth.status !== 'authenticated') return null;

  const openClientModal = (r: ClientOperationsRegistryRow) => {
    setModalOpen(true);
    setModalLoading(true);
    setModalError('');
    setModalData(buildPlaceholderClientCaseFromRegistryRow(r));
    apiJson<ClientOperationsCaseResponse>(moduleClientOperationsCase(r.client_id))
      .then((res) => setModalData(res))
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setModalLoading(false));
  };

  const openNotesModal = (r: ClientOperationsRegistryRow) => {
    setNotesModalClientId(r.client_id);
    setNotesModalClientName(r.client_name ?? '');
    setEditingNoteId(null);
    setFormBody('');
    setFormReminderLocal('');
    setConflict(null);
    const first = noteTypes[0]?.code ?? '';
    setFormTypeCode(first);
  };

  const closeNotesModal = () => {
    setNotesModalClientId(null);
    setConflict(null);
  };

  const startEditNote = (n: OperationalNoteRow) => {
    setEditingNoteId(n.id);
    setFormTypeCode(n.type_code);
    setFormBody(n.body);
    setFormReminderLocal(isoToDatetimeLocal(n.reminder_at));
    setConflict(null);
  };

  const selectedType = noteTypes.find((t) => t.code === formTypeCode);
  const allowsReminder = selectedType?.allows_reminder ?? false;

  const runSave = async (ignoreConflict: boolean) => {
    if (!notesModalClientId || !canEdit) return;
    const bodyText = formBody.trim();
    if (!bodyText) return;
    setFormSaving(true);
    setNotesError('');
    try {
      const reminderIso = allowsReminder ? datetimeLocalToIso(formReminderLocal) : null;
      const payload: Record<string, unknown> = {
        type_code: formTypeCode,
        body: bodyText,
        reminder_at: reminderIso,
        ignore_reminder_conflict: ignoreConflict,
      };
      const url =
        editingNoteId ?
          moduleClientOperationsOperationalNote(notesModalClientId, editingNoteId)
        : moduleClientOperationsOperationalNotes(notesModalClientId);
      const method = editingNoteId ? 'PATCH' : 'POST';
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => ({}));
      if (res.status === 409 && (raw as ConflictPayload).code === 'REMINDER_CONFLICT') {
        setConflict(raw as ConflictPayload);
        setFormSaving(false);
        return;
      }
      if (!res.ok) {
        setNotesError((raw as { message?: string }).message ?? res.statusText);
        setFormSaving(false);
        return;
      }
      setConflict(null);
      setEditingNoteId(null);
      setFormBody('');
      setFormReminderLocal('');
      setFormTypeCode(noteTypes[0]?.code ?? formTypeCode);
      closeNotesModal();

      const registryPreview = (raw as { registryPreview?: { notes_cell_text_he: string | null; operational_notes_count: number } }).registryPreview;
      if (registryPreview && notesModalClientId) {
        setRows((prev) =>
          prev.map((row) =>
            row.client_id === notesModalClientId
              ? {
                  ...row,
                  notes_cell_text_he: registryPreview.notes_cell_text_he,
                  operational_notes_count: registryPreview.operational_notes_count,
                }
              : row,
          ),
        );
      }
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : 'Error');
    } finally {
      setFormSaving(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!notesModalClientId || !canEdit) return;
    if (!window.confirm('למחוק הערה?')) return;
    setNotesError('');
    const res = await apiFetch(moduleClientOperationsOperationalNote(notesModalClientId, noteId), { method: 'DELETE' });
    if (!res.ok) {
      const raw = await res.json().catch(() => ({}));
      setNotesError((raw as { message?: string }).message ?? 'Delete failed');
      return;
    }
    if (editingNoteId === noteId) {
      setEditingNoteId(null);
      setFormBody('');
      setFormReminderLocal('');
    }
    const list = await apiJson<{ notes: OperationalNoteRow[] }>(moduleClientOperationsOperationalNotes(notesModalClientId));
    setOperationalNotes(Array.isArray(list?.notes) ? list.notes : []);
    reloadRegistry();
  };

  return (
    <div>
      <PageHeader title="Nodex לקוחות" subtitle="Client registry (module v1 skeleton)" />

      <SectionCard style={{ padding: 20 }}>
        {error && <div style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</div>}
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, direction: 'rtl' }}>
                {(() => {
                  const columns = [
                    {
                      id: 'folder',
                      header: '📁',
                      width: 40,
                      thStyle: { padding: '12px 8px', textAlign: 'center' },
                      tdStyle: { width: 40, padding: '12px 8px', textAlign: 'center' },
                      render: (r: ClientOperationsRegistryRow) => (
                        <button
                          type="button"
                          onClick={() => openClientModal(r)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 18,
                            lineHeight: 1,
                          }}
                          aria-label={`Open client case ${r.client_name ?? ''}`}
                        >
                          📁
                        </button>
                      ),
                    },
                    {
                      id: 'client_name',
                      header: 'שם לקוח',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', fontWeight: 600, textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.client_name),
                    },
                    {
                      id: 'tax_id',
                      header: 'ח.פ',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', fontFamily: 'monospace', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.tax_id),
                    },
                    {
                      id: 'business_type',
                      header: 'סוג עסק',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.business_type),
                    },
                    {
                      id: 'payroll',
                      header: 'שכר',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.payroll_flag),
                    },
                    {
                      id: 'material_brought',
                      header: 'הביא חומר כן/לא',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.material_brought_flag),
                    },
                    {
                      id: 'vat',
                      header: 'מע״מ',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.vat_status),
                    },
                    {
                      id: 'vat_due',
                      header: 'יום יעד דיווח מע״מ',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right', fontWeight: 600 },
                      render: (r: ClientOperationsRegistryRow) =>
                        renderCell(r.vat_due_registry_display_he),
                    },
                    {
                      id: 'income_tax_advance',
                      header: 'מקדמות מס הכנסה',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.income_tax_advance_status),
                    },
                    {
                      id: 'national_insurance',
                      header: 'ביטוח לאומי',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderNationalInsuranceCell(r.national_insurance_status),
                    },
                    {
                      id: 'national_insurance_deductions',
                      header: 'ביטוח לאומי ניכויים',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.national_insurance_deductions_status),
                    },
                    {
                      id: 'income_tax_deductions',
                      header: 'מס הכנסה ניכויים',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.income_tax_deductions_status),
                    },
                    {
                      id: 'handler',
                      header: 'מטפל בתיק',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: { padding: '12px 16px', fontFamily: 'monospace', textAlign: 'right' },
                      render: (r: ClientOperationsRegistryRow) => renderCell(r.assigned_handler_user_id),
                    },
                    {
                      id: 'notes',
                      header: 'הערות',
                      thStyle: { padding: '12px 16px', textAlign: 'right' },
                      tdStyle: {
                        padding: '12px 16px',
                        color: '#374151',
                        textAlign: 'right',
                        maxWidth: 280,
                        cursor: 'pointer',
                        verticalAlign: 'top',
                      },
                      render: (r: ClientOperationsRegistryRow) => (
                        <button
                          type="button"
                          onClick={() => openNotesModal(r)}
                          style={{
                            width: '100%',
                            textAlign: 'right',
                            background: 'rgba(59,130,246,0.06)',
                            border: '1px solid #e5e7eb',
                            borderRadius: 8,
                            padding: '8px 10px',
                            cursor: 'pointer',
                            fontSize: 13,
                            lineHeight: 1.35,
                          }}
                        >
                          {r.notes_cell_text_he ?? '—'}
                        </button>
                      ),
                    },
                  ];

                  return (
                    <>
                      <thead>
                        <tr style={{ background: '#f3f4f6' }}>
                          {columns.map((c) => (
                            <th key={c.id} style={{ ...(c.thStyle as React.CSSProperties) }}>
                              {c.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.client_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            {columns.map((c) => (
                              <td key={c.id} style={{ ...(c.tdStyle as React.CSSProperties) }}>
                                {c.render(r)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </>
                  );
                })()}
              </table>
            </div>

            {rows.length === 0 && <p style={{ padding: 24, color: '#6b7280', textAlign: 'center' }}>No clients found.</p>}
          </>
        )}
      </SectionCard>

      {modalOpen && (
        <ClientWorkspaceModal
          open={modalOpen}
          workspace={modalData}
          loading={modalLoading}
          error={modalError}
          onClose={() => setModalOpen(false)}
          onSaveSuccess={() => {
            setModalOpen(false);
            reloadRegistry();
          }}
          onTaxSettingsSaved={reloadRegistry}
        />
      )}

      {notesModalClientId && (
        <ClientNoteModal
          open
          clientName={notesModalClientName || 'לקוח'}
          noteType={formTypeCode}
          noteText={formBody}
          reminderAt={formReminderLocal}
          onClose={closeNotesModal}
          onSave={() => runSave(false)}
          onTypeChange={(value) => {
            setFormTypeCode(value);
            const t = noteTypes.find((x) => x.code === value);
            if (!t?.allows_reminder) setFormReminderLocal('');
          }}
          onTextChange={setFormBody}
          onReminderAtChange={setFormReminderLocal}
        >
          {notesLoading ? (
            <div className="nx-empty-note">אין הערות עדיין</div>
          ) : (
            <>
              {notesError && <div className="nx-alert-error">{notesError}</div>}

              {operationalNotes.length === 0 ? (
                <div className="nx-empty-note">אין הערות עדיין</div>
              ) : (
                <div className="nx-modal-notes-list">
                  {operationalNotes.map((n) => (
                    <div key={n.id} className="nx-note-card">
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                        <div className="nx-note-card-meta">
                          {n.type_label_he}
                          {n.reminder_at
                            ? ` · ${new Date(n.reminder_at).toLocaleString('he-IL', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}`
                            : ''}
                        </div>
                        <div className="nx-note-card-body">{n.body}</div>
                      </div>
                      {canEdit && (
                        <div className="nx-note-card-actions">
                          <button
                            type="button"
                            className="nx-btn nx-btn-ghost"
                            onClick={() => startEditNote(n)}
                          >
                            עריכה
                          </button>
                          <button
                            type="button"
                            className="nx-btn nx-btn-ghost"
                            style={{ color: '#2563eb' }}
                            onClick={() => deleteNote(n.id)}
                          >
                            מחיקה
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {conflict && (
                <div className="nx-conflict-panel">
                  <h3>{conflict.ui.title_he}</h3>
                  <p>{conflict.ui.message_he}</p>
                  <ul>
                    {conflict.conflicts.map((c, i) => (
                      <li key={i}>
                        <strong>{c.client_display_name ?? 'לקוח'}</strong> — {c.type_label_he}: {c.body_preview}
                      </li>
                    ))}
                  </ul>
                  <div className="nx-modal-footer" style={{ paddingTop: 0 }}>
                    <button type="button" className="nx-btn nx-btn-primary" onClick={() => runSave(true)}>
                      {conflict.ui.button_create_anyway_he}
                    </button>
                    <button type="button" className="nx-btn nx-btn-secondary" onClick={() => setConflict(null)}>
                      {conflict.ui.button_change_time_he}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </ClientNoteModal>
      )}
    </div>
  );
}

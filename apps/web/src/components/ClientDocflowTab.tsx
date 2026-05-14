import { useEffect, useMemo, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { getBackendActiveOrganizationId } from '../api/org-context';
import { docflowClientTabAggregate, docflowOfficeCommands } from '../api/endpoints';
import { newDocflowIdempotencyKey } from '../lib/idempotency-key';

type UnknownRecord = Record<string, unknown>;

type AllowedAction = {
  command?: string;
  enabled?: boolean;
  reason?: string | null;
};

async function fileToBase64(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const s = String(reader.result ?? '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.readAsDataURL(file);
  });
}

export function ClientDocflowTab({ clientId }: { clientId: string }) {
  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyCommand, setBusyCommand] = useState('');
  const [composer, setComposer] = useState('');
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadType, setNewThreadType] = useState('question');
  const [uploadingFile, setUploadingFile] = useState(false);

  async function loadAggregate(selectedThreadId?: string | null): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const out = (await apiJson(docflowClientTabAggregate(clientId, selectedThreadId))) as UnknownRecord;
      setAggregate(out);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAggregate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const threadList = useMemo(() => {
    const list = aggregate?.thread_list;
    return Array.isArray(list) ? (list as UnknownRecord[]) : [];
  }, [aggregate]);

  const selectedThread = useMemo(() => {
    const st = aggregate?.selected_thread;
    return st && typeof st === 'object' ? (st as UnknownRecord) : null;
  }, [aggregate]);

  const selectedThreadId = String(selectedThread?.id ?? '');

  const messages = useMemo(() => {
    const list = aggregate?.messages;
    return Array.isArray(list) ? (list as UnknownRecord[]) : [];
  }, [aggregate]);
  const attachments = useMemo(() => {
    const list = aggregate?.attachments;
    return Array.isArray(list) ? (list as UnknownRecord[]) : [];
  }, [aggregate]);

  const aggregateActions = useMemo(() => {
    const list = aggregate?.allowed_actions;
    return Array.isArray(list) ? (list as AllowedAction[]) : [];
  }, [aggregate]);

  const threadActions = useMemo(() => {
    const list = selectedThread?.allowed_actions;
    return Array.isArray(list) ? (list as AllowedAction[]) : [];
  }, [selectedThread]);

  const actionByCommand = useMemo(() => {
    const m = new Map<string, AllowedAction>();
    for (const a of aggregateActions) {
      const cmd = String(a.command ?? '').trim();
      if (cmd) m.set(cmd, a);
    }
    for (const a of threadActions) {
      const cmd = String(a.command ?? '').trim();
      if (cmd) m.set(cmd, a);
    }
    return m;
  }, [aggregateActions, threadActions]);

  function isCommandEnabled(command: string): { enabled: boolean; reason: string | null } {
    const a = actionByCommand.get(command);
    if (!a) return { enabled: false, reason: 'Action not available' };
    return { enabled: a.enabled !== false, reason: (a.reason as string | null) ?? null };
  }

  async function runCommand(command: string, payload: UnknownRecord): Promise<void> {
    const can = isCommandEnabled(command);
    if (!can.enabled) return;
    setBusyCommand(command);
    setError('');
    try {
      const orgId = getBackendActiveOrganizationId() ?? '';
      if (!orgId) throw new Error('No active organization selected');
      const out = (await apiJson(docflowOfficeCommands, {
        method: 'POST',
        body: JSON.stringify({
          command,
          payload: {
            org_id: orgId,
            client_id: clientId,
            ...payload,
          },
        }),
      })) as { refreshed?: { aggregate?: UnknownRecord } };
      const refreshed = out.refreshed?.aggregate;
      if (!refreshed || typeof refreshed !== 'object') throw new Error('DocFlow aggregate refresh missing');
      setAggregate(refreshed);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusyCommand('');
    }
  }

  async function uploadAndAttachFile(file: File): Promise<void> {
    if (!selectedThreadId) return;
    const can = isCommandEnabled('send_office_message_with_attachment');
    if (!can.enabled) return;
    setUploadingFile(true);
    setError('');
    try {
      const base64 = await fileToBase64(file);
      const caption = composer.trim();
      await runCommand('send_office_message_with_attachment', {
        thread_id: selectedThreadId,
        file_base64: base64,
        file_name: file.name,
        mime_type: file.type || null,
        ...(caption ? { body: caption } : {}),
        idempotency_key: newDocflowIdempotencyKey(),
      });
      if (caption) setComposer('');
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setUploadingFile(false);
    }
  }

  if (loading) {
    return (
      <div className="client-profile-card">
        <p style={{ padding: 16, margin: 0, color: '#6b7280' }}>טוען DocFlow…</p>
      </div>
    );
  }

  const entitlement = (aggregate?.entitlement_status as UnknownRecord | undefined) ?? null;
  if (!entitlement || entitlement.active !== true) {
    return (
      <div className="client-profile-card">
        <p style={{ padding: 16, margin: 0, color: '#6b7280' }}>DocFlow לא זמין לארגון זה.</p>
      </div>
    );
  }

  return (
    <div className="client-profile-card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700 }}>{String((aggregate?.client_header as UnknownRecord | undefined)?.display_name ?? '')}</div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            Portal: {String((aggregate?.portal_access_status as UnknownRecord | undefined)?.status ?? 'unknown')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!isCommandEnabled('revoke_client_portal_access').enabled || busyCommand.length > 0}
            onClick={() => void runCommand('revoke_client_portal_access', {})}
            className="nx-btn nx-btn-taxes-compact"
          >
            Revoke Portal
          </button>
        </div>
      </div>

      {error ? <p style={{ color: '#b91c1c', margin: '0 0 10px' }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb', display: 'grid', gap: 8 }}>
            <input
              value={newThreadTitle}
              onChange={(e) => setNewThreadTitle(e.target.value)}
              placeholder="Thread title"
              style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6 }}
            />
            <select
              value={newThreadType}
              onChange={(e) => setNewThreadType(e.target.value)}
              style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6 }}
            >
              <option value="document_request">document_request</option>
              <option value="question">question</option>
              <option value="reminder">reminder</option>
              <option value="task_followup">task_followup</option>
            </select>
            <button
              type="button"
              disabled={!isCommandEnabled('create_client_thread').enabled || !newThreadTitle.trim() || busyCommand.length > 0}
              onClick={() =>
                void runCommand('create_client_thread', {
                  module_key: 'client-operations',
                  thread_type: newThreadType,
                  title: newThreadTitle.trim(),
                })
              }
              className="nx-btn nx-btn-taxes-compact"
            >
              + New thread
            </button>
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {!threadList.length ? (
              <p style={{ margin: 0, padding: 12, color: '#6b7280' }}>No threads</p>
            ) : (
              threadList.map((t) => {
                const id = String(t.id ?? '');
                const selected = id === selectedThreadId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void loadAggregate(id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'right',
                      padding: 10,
                      border: 'none',
                      borderBottom: '1px solid #f3f4f6',
                      background: selected ? '#eff6ff' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{String(t.thread_type_label ?? t.thread_type ?? '')}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{String(t.thread_status_label ?? t.thread_status ?? '')}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Unread: {String(t.unread_count ?? 0)}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          <div style={{ padding: 10, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{String(selectedThread?.thread_type_label ?? 'Select thread')}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{String(selectedThread?.thread_status_label ?? '')}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                SLA: {String((selectedThread?.sla_indicator as UnknownRecord | undefined)?.label ?? '—')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={!isCommandEnabled('mark_thread_read_by_office').enabled || !selectedThreadId || busyCommand.length > 0}
                onClick={() => void runCommand('mark_thread_read_by_office', { thread_id: selectedThreadId })}
              >
                Mark read
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={!isCommandEnabled('archive_client_thread').enabled || !selectedThreadId || busyCommand.length > 0}
                onClick={() => void runCommand('archive_client_thread', { thread_id: selectedThreadId })}
                title={isCommandEnabled('archive_client_thread').reason ?? undefined}
              >
                Archive
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={!isCommandEnabled('reopen_client_thread').enabled || !selectedThreadId || busyCommand.length > 0}
                onClick={() => void runCommand('reopen_client_thread', { thread_id: selectedThreadId })}
                title={isCommandEnabled('reopen_client_thread').reason ?? undefined}
              >
                Reopen
              </button>
            </div>
          </div>

          <div style={{ padding: 10, overflow: 'auto', flex: 1 }}>
            {!selectedThreadId ? (
              <p style={{ color: '#6b7280' }}>Select a thread</p>
            ) : !messages.length ? (
              <p style={{ color: '#6b7280' }}>{String((aggregate?.empty_states as UnknownRecord | undefined)?.no_messages ? 'No messages yet' : '')}</p>
            ) : (
              messages.map((m) => (
                <div key={String(m.id ?? '')} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {String(m.created_by_type ?? '')} · {String(m.created_at ?? '')}
                  </div>
                  <div>{String(m.body ?? '')}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                    Attachments: {attachments.filter((a) => String(a.message_id ?? '') === String(m.id ?? '')).length}
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ padding: 10, borderTop: '1px solid #e5e7eb', display: 'grid', gap: 8 }}>
            <textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="Write office message"
              rows={3}
              style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: 8, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={!isCommandEnabled('send_office_message').enabled || !selectedThreadId || !composer.trim() || busyCommand.length > 0}
                onClick={() =>
                  void runCommand('send_office_message', {
                    thread_id: selectedThreadId,
                    message_type: 'text',
                    body: composer.trim(),
                    idempotency_key: newDocflowIdempotencyKey(),
                  }).then(() => setComposer(''))
                }
              >
                Send
              </button>
              <label className="nx-btn nx-btn-taxes-compact" style={{ cursor: 'pointer' }}>
                {uploadingFile ? 'Uploading…' : 'Upload & attach'}
                <input
                  type="file"
                  style={{ display: 'none' }}
                  disabled={
                    uploadingFile ||
                    busyCommand.length > 0 ||
                    !isCommandEnabled('send_office_message_with_attachment').enabled ||
                    !selectedThreadId
                  }
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (!file) return;
                    void uploadAndAttachFile(file);
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


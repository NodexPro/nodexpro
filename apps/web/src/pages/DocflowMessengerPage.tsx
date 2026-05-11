import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { newDocflowIdempotencyKey } from '../lib/idempotency-key';
import {
  docflowOfficeCommands,
  docflowOfficeFileOpen,
  docflowOfficeMessengerAggregate,
  docflowStartOfficeThreadForClient,
} from '../api/endpoints';

type UnknownRecord = Record<string, unknown>;

type CommandResponse = {
  ok?: boolean;
  refreshed?: { aggregate_key?: string; aggregate?: UnknownRecord };
};

type AllowedAction = { command?: string; enabled?: boolean; reason?: string | null };

function isRecord(v: unknown): v is UnknownRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const MESSENGER_PAGE_SIZE = 50;

/** Request documents: stroke-only vector, gradient on lines only — no filled disc, no shadow (Slack/Linear-style). */
function DocflowClientRequestGlyph(): ReactElement {
  const uid = useId().replace(/:/g, '');
  const gid = `nx-df-req-${uid}`;
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <linearGradient id={gid} x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563EB" />
          <stop offset="0.5" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      <path
        d="M4.75 5.35h5.45L13.6 8.75v8.9H4.75A.85.85 0 0 1 3.9 16.8V6.2a.85.85 0 0 1 .85-.85Z"
        stroke={`url(#${gid})`}
        strokeWidth="1.35"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M10.2 5.35v3.4h3.4" stroke={`url(#${gid})`} strokeWidth="1.35" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M6.55 10.45h5.35M6.55 12.05h5.35M6.55 13.65h3.45" stroke={`url(#${gid})`} strokeWidth="1.1" strokeLinecap="round" />
      <path d="M15.35 4.75v2M14.35 5.75h2" stroke={`url(#${gid})`} strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

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

export function DocflowMessengerPage() {
  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [composer, setComposer] = useState('');
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestTemplateId, setRequestTemplateId] = useState('');
  const [requestSelectedItemIds, setRequestSelectedItemIds] = useState<string[]>([]);
  const [requestNote, setRequestNote] = useState('');
  const [searchClient, setSearchClient] = useState('');
  const inflightAbort = useRef<AbortController | null>(null);
  const searchClientRef = useRef('');

  useEffect(() => {
    searchClientRef.current = searchClient;
  }, [searchClient]);

  const clientList = useMemo(() => {
    const list = aggregate?.client_list;
    return Array.isArray(list) ? (list as UnknownRecord[]) : [];
  }, [aggregate]);

  const clientContext = aggregate;

  const selectedClientId = String(
    (clientContext?.client_header as UnknownRecord | undefined)?.client_id ??
      (clientContext?.selection as UnknownRecord | undefined)?.selected_client_id ??
      ''
  ).trim();
  const effectiveSelectedClientId = selectedClientId;

  const selectedThread = useMemo(() => {
    const st = clientContext?.selected_thread;
    return isRecord(st) ? st : null;
  }, [clientContext]);
  const selectedThreadId = String(selectedThread?.id ?? '').trim();

  const messages = useMemo(() => {
    const list = clientContext?.messages;
    return Array.isArray(list) ? (list as UnknownRecord[]) : [];
  }, [clientContext]);

  const attachments = useMemo(() => {
    const list = clientContext?.attachments;
    return Array.isArray(list) ? (list as UnknownRecord[]) : [];
  }, [clientContext]);

  const availableRequestTemplates = useMemo(() => {
    const t = clientContext?.available_request_templates;
    return Array.isArray(t) ? (t as UnknownRecord[]) : [];
  }, [clientContext]);

  const selectedRequestTemplate = useMemo(() => {
    const id = requestTemplateId.trim();
    if (!id) return null;
    return availableRequestTemplates.find((t) => String(t.id ?? '').trim() === id) ?? null;
  }, [availableRequestTemplates, requestTemplateId]);

  function resetRequestDraftFromTemplate(tpl: UnknownRecord | null): void {
    if (!tpl) {
      setRequestTemplateId('');
      setRequestSelectedItemIds([]);
      setRequestNote('');
      return;
    }
    const tid = String(tpl.id ?? '').trim();
    const items = Array.isArray(tpl.items) ? (tpl.items as UnknownRecord[]) : [];
    const allIds = items.map((it) => String(it.id ?? '').trim()).filter(Boolean);
    setRequestTemplateId(tid);
    setRequestSelectedItemIds(allIds);
    setRequestNote('');
  }

  const actions = useMemo(() => {
    const list = clientContext?.allowed_actions;
    return Array.isArray(list) ? (list as AllowedAction[]) : [];
  }, [clientContext]);

  const actionByCommandGlobal = useMemo(() => {
    const m = new Map<string, AllowedAction>();
    for (const a of actions) {
      const cmd = String(a.command ?? '').trim();
      if (cmd) m.set(cmd, a);
    }
    return m;
  }, [actions]);

  const actionByCommand = useMemo(() => {
    const m = new Map<string, AllowedAction>();
    for (const a of actions) {
      const cmd = String(a.command ?? '').trim();
      if (cmd) m.set(cmd, a);
    }
    const threadActionsRaw = selectedThread?.allowed_actions;
    const threadActions = Array.isArray(threadActionsRaw) ? (threadActionsRaw as AllowedAction[]) : [];
    for (const a of threadActions) {
      const cmd = String(a.command ?? '').trim();
      if (cmd) m.set(cmd, a);
    }
    return m;
  }, [actions, selectedThread]);

  function canRun(command: string): { enabled: boolean; reason: string | null } {
    const a = actionByCommand.get(command);
    if (!a) return { enabled: false, reason: 'הפעולה אינה זמינה' };
    return { enabled: a.enabled !== false, reason: (a.reason as string | null) ?? null };
  }

  function canRunGlobal(command: string): { enabled: boolean; reason: string | null } {
    const a = actionByCommandGlobal.get(command);
    if (!a) return { enabled: false, reason: 'הפעולה אינה זמינה' };
    return { enabled: a.enabled !== false, reason: (a.reason as string | null) ?? null };
  }

  const loadMessenger = useCallback(async (opts?: { searchClient?: string; clientId?: string | null; threadId?: string | null }) => {
    inflightAbort.current?.abort();
    const ac = new AbortController();
    inflightAbort.current = ac;

    setLoading(true);
    setError('');
    try {
      const search = String(opts?.searchClient ?? searchClientRef.current).trim();
      const cid = String(opts?.clientId ?? '').trim();
      const tid = String(opts?.threadId ?? '').trim();
      const out = (await apiJson<UnknownRecord>(
        docflowOfficeMessengerAggregate({
          page: 1,
          pageSize: MESSENGER_PAGE_SIZE,
          searchClient: search || undefined,
          clientId: cid || undefined,
          threadId: tid || undefined,
        }),
        { signal: ac.signal }
      )) as UnknownRecord;
      if (String(out.aggregate_key ?? '') !== 'office_docflow_messenger_aggregate') {
        throw new Error('תגובת השרת אינה אגרגט DocFlow messenger תקין');
      }
      setAggregate(out);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setAggregate(null);
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMessenger({});
  }, [loadMessenger]);

  function messengerCommandPayload(extra: UnknownRecord = {}): UnknownRecord {
    const search = searchClientRef.current.trim();
    return {
      client_id: effectiveSelectedClientId,
      refresh_target: 'office_messenger',
      page: 1,
      page_size: MESSENGER_PAGE_SIZE,
      ...(search ? { search_client: search } : {}),
      ...extra,
    };
  }

  async function runOfficeCommand(command: string, payload: UnknownRecord): Promise<void> {
    if (!effectiveSelectedClientId) return;
    const can = canRun(command);
    if (!can.enabled) return;
    setBusy(command);
    setError('');
    try {
      const out = (await apiJson<CommandResponse>(docflowOfficeCommands, {
        method: 'POST',
        body: JSON.stringify({
          command,
          payload: messengerCommandPayload({
            thread_id: selectedThreadId || undefined,
            ...payload,
          }),
        }),
      })) as CommandResponse;
      const refreshed = out.refreshed?.aggregate;
      if (!isRecord(refreshed)) throw new Error('חסר אגרגט מעודכן מהשרת');
      if (String(out.refreshed?.aggregate_key ?? '') !== 'office_docflow_messenger_aggregate') {
        throw new Error('השרת לא החזיר office docflow messenger aggregate');
      }
      setAggregate(refreshed);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function openOfficeAttachment(fileAssetId: string): Promise<void> {
    if (!effectiveSelectedClientId) return;
    setError('');
    try {
      const out = (await apiJson<{ url?: string }>(docflowOfficeFileOpen(fileAssetId, effectiveSelectedClientId), {
        method: 'GET',
      })) as { url?: string };
      const url = typeof out.url === 'string' ? out.url : '';
      if (!url) throw new Error('חסר קישור מאובטח להורדה');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  }

  async function uploadAndAttachFile(file: File): Promise<void> {
    if (!selectedThreadId || !effectiveSelectedClientId) return;
    const can = canRun('send_office_message_with_attachment');
    if (!can.enabled) return;
    setUploadingFile(true);
    setError('');
    try {
      const base64 = await fileToBase64(file);
      const caption = composer.trim();
      await runOfficeCommand('send_office_message_with_attachment', {
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

  async function startThread(): Promise<void> {
    if (!effectiveSelectedClientId) return;
    setBusy('start_office_thread_for_client');
    setError('');
    try {
      const out = (await apiJson<CommandResponse>(docflowStartOfficeThreadForClient, {
        method: 'POST',
        body: JSON.stringify({
          payload: messengerCommandPayload({}),
        }),
      })) as CommandResponse;
      const refreshed = out.refreshed?.aggregate;
      if (!isRecord(refreshed)) throw new Error('חסר אגרגט מעודכן מהשרת');
      if (String(out.refreshed?.aggregate_key ?? '') !== 'office_docflow_messenger_aggregate') {
        throw new Error('השרת לא החזיר office docflow messenger aggregate');
      }
      setAggregate(refreshed);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy('');
    }
  }

  const clientHeader = (clientContext?.client_header as UnknownRecord | undefined) ?? null;
  const clientName = String(clientHeader?.display_name ?? '').trim();

  const emptyStates = (clientContext?.empty_states as UnknownRecord | undefined) ?? null;
  const noThreads = emptyStates?.no_threads === true;

  const isNarrow = typeof window !== 'undefined' ? window.matchMedia?.('(max-width: 900px)')?.matches === true : false;

  async function openRequestForClient(clientId: string): Promise<void> {
    const cid = clientId.trim();
    if (!cid) return;
    if (!canRunGlobal('create_docflow_document_request').enabled) return;
    await loadMessenger({ clientId: cid, threadId: null, searchClient: searchClientRef.current.trim() });
    const first = availableRequestTemplates[0] ?? null;
    resetRequestDraftFromTemplate(first && isRecord(first) ? first : null);
    setRequestModalOpen(true);
  }

  return (
    <div dir="rtl" lang="he" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>DocFlow</div>
          <div style={{ fontSize: 12.5, color: '#64748B' }}>מסנג׳ר משרד</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={searchClient}
            onChange={(e) => setSearchClient(e.target.value)}
            placeholder="חיפוש לקוח…"
            style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #CBD5E1', minWidth: 240 }}
          />
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy.length > 0}
            onClick={() => void loadMessenger({ searchClient: searchClient.trim() })}
          >
            חפש
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: '8px 12px', color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, marginBottom: 10 }}>
          {error}
        </div>
      ) : null}

      {loading && !aggregate ? <div style={{ color: '#64748B' }}>טוען…</div> : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isNarrow ? '1fr' : '360px 1fr',
          // Narrow: aside is auto-sized; conversation row must take remaining viewport height so the
          // messages pane (flex:1; overflow:auto) gets a definite height and full history can scroll.
          // Desktop: single row fills minHeight so both columns stretch like pre–Fix-1 layout.
          gridTemplateRows: isNarrow ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: 12,
          minHeight: 'calc(100dvh - 160px)',
        }}
      >
        <aside style={{ border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #E5E7EB', fontSize: 13, color: '#64748B' }}>לקוחות</div>
          <div style={{ maxHeight: isNarrow ? 260 : 'calc(100dvh - 240px)', overflow: 'auto' }}>
            {clientList.length === 0 ? (
              <div style={{ padding: 12, color: '#64748B' }}>אין לקוחות להצגה.</div>
            ) : (
              clientList.map((c) => {
                const id = String(c.client_id ?? '');
                const name = String(c.display_name ?? '').trim() || 'לקוח';
                const unread = Number(c.unread_count ?? 0) || 0;
                const active = id && id === effectiveSelectedClientId;
                const canRequest = canRunGlobal('create_docflow_document_request');
                return (
                  <div
                    key={id}
                    style={{
                      borderBottom: '1px solid #F1F5F9',
                      background: active ? '#EFF6FF' : '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <button
                          type="button"
                          onClick={() => void loadMessenger({ clientId: id, threadId: null, searchClient: searchClientRef.current.trim() })}
                          style={{
                            flex: '1 1 0%',
                            minWidth: 0,
                            textAlign: 'start',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: 0,
                            fontWeight: 700,
                            fontSize: 14,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: '#0F172A',
                          }}
                        >
                          {name}
                        </button>
                        {canRequest.enabled ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void openRequestForClient(id);
                            }}
                            title="לבקש מלקוח"
                            aria-label="לבקש מלקוח"
                            style={{
                              flexShrink: 0,
                              border: 'none',
                              background: 'transparent',
                              padding: 4,
                              margin: -4,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              lineHeight: 0,
                            }}
                          >
                            <DocflowClientRequestGlyph />
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadMessenger({ clientId: id, threadId: null, searchClient: searchClientRef.current.trim() })}
                        style={{
                          alignSelf: 'stretch',
                          textAlign: 'start',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 12,
                          color: '#64748B',
                        }}
                      >
                        Threads: {String(c.active_thread_count ?? 0)}
                      </button>
                    </div>

                    {unread > 0 ? (
                      <span
                        style={{
                          minWidth: 22,
                          height: 22,
                          borderRadius: 11,
                          background: '#22C55E',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 6px',
                          flexShrink: 0,
                        }}
                      >
                        {unread > 99 ? '99+' : unread}
                      </span>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section
          style={{
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            overflow: 'hidden',
            background: '#F8FAFC',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #E5E7EB', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{clientName || 'בחרו לקוח'}</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                {selectedThread ? `${String(selectedThread.thread_type_label ?? selectedThread.thread_type ?? '')} · ${String(selectedThread.thread_status_label ?? '')}` : '—'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={!selectedThreadId || busy.length > 0 || !canRun('mark_thread_read_by_office').enabled}
                onClick={() => void runOfficeCommand('mark_thread_read_by_office', { thread_id: selectedThreadId })}
              >
                נקרא
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={!selectedThreadId || busy.length > 0 || !canRun('archive_client_thread').enabled}
                title={canRun('archive_client_thread').reason ?? undefined}
                onClick={() => void runOfficeCommand('archive_client_thread', { thread_id: selectedThreadId })}
              >
                ארכיון
              </button>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, WebkitOverflowScrolling: 'touch' as const }}>
            {!effectiveSelectedClientId ? (
              <div style={{ color: '#64748B' }}>בחרו לקוח מהרשימה כדי לצפות בהתכתבות.</div>
            ) : noThreads ? (
              <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
                <div style={{ fontWeight: 800, color: '#0F172A' }}>עדיין אין שיחות עם הלקוח</div>
                <div style={{ color: '#64748B', fontSize: 13.5 }}>לחצו כדי לפתוח שיחה חדשה</div>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  style={{ width: 'fit-content', minWidth: 140 }}
                  disabled={busy.length > 0}
                  onClick={() => void startThread()}
                >
                  פתיחת שיחה
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div style={{ color: '#64748B' }}>אין הודעות בשיחה זו.</div>
            ) : (
              messages.map((m) => {
                const id = String(m.id ?? '');
                const by = String(m.created_by_type ?? '');
                const mine = by === 'office';
                const msgAttachments = attachments.filter((a) => String(a.message_id ?? '') === id);
                return (
                  <div key={id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                    <div style={{ maxWidth: '82%', background: mine ? '#DBEAFE' : '#fff', border: '1px solid #E2E8F0', borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px', padding: '8px 10px' }}>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.35, fontSize: 14 }}>{String(m.body ?? '')}</div>
                      {msgAttachments.length > 0 ? (
                        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                          {msgAttachments.map((a) => {
                            const fid = String(a.file_asset_id ?? '').trim();
                            const label = String(a.file_name ?? '').trim() || fid.slice(0, 8);
                            return (
                              <button
                                key={String(a.id ?? fid)}
                                type="button"
                                className="nx-btn nx-btn-taxes-compact"
                                style={{ fontSize: 12, justifySelf: 'start' }}
                                disabled={!fid || !effectiveSelectedClientId}
                                onClick={() => void openOfficeAttachment(fid)}
                              >
                                📎 {label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <div style={{ marginTop: 6, fontSize: 11, color: '#64748B', textAlign: mine ? 'left' : 'right' }}>
                        {String(m.created_at ?? '')}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ padding: 12, borderTop: '1px solid #E5E7EB', background: '#fff', display: 'grid', gap: 8 }}>
            <textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="כתבו הודעה…"
              rows={3}
              style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 12, padding: 10, boxSizing: 'border-box', fontSize: 14, resize: 'vertical' }}
              disabled={!selectedThreadId || busy.length > 0}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                style={{ minWidth: 110 }}
                disabled={!selectedThreadId || busy.length > 0 || !composer.trim() || !canRun('send_office_message').enabled}
                onClick={() =>
                  void runOfficeCommand('send_office_message', {
                    thread_id: selectedThreadId,
                    message_type: 'text',
                    body: composer.trim(),
                    idempotency_key: newDocflowIdempotencyKey(),
                  }).then(() => setComposer(''))
                }
              >
                שליחה
              </button>
              <label className="nx-btn nx-btn-taxes-compact" style={{ cursor: 'pointer' }}>
                {uploadingFile ? 'מעלה…' : 'צרף קובץ'}
                <input
                  type="file"
                  style={{ display: 'none' }}
                  disabled={
                    uploadingFile ||
                    busy.length > 0 ||
                    !selectedThreadId ||
                    !canRun('send_office_message_with_attachment').enabled
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
        </section>
      </div>

      {requestModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setRequestModalOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              width: 'min(720px, 96vw)',
              borderRadius: 14,
              border: '1px solid #E5E7EB',
              boxShadow: '0 10px 30px rgba(15,23,42,0.14)',
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h3 style={{ margin: 0 }}>Create Document Request</h3>
              <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => setRequestModalOpen(false)}>
                X
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700, color: '#374151' }}>
                Template
                <select
                  value={requestTemplateId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const tpl = availableRequestTemplates.find((t) => String(t.id ?? '').trim() === id) ?? null;
                    resetRequestDraftFromTemplate(tpl && isRecord(tpl) ? tpl : null);
                  }}
                  style={{ height: 38, borderRadius: 10, border: '1px solid #CBD5E1', padding: '0 12px', fontSize: 14 }}
                  disabled={busy.length > 0}
                >
                  <option value="">Select template</option>
                  {availableRequestTemplates.map((t) => {
                    const id = String(t.id ?? '').trim();
                    const name = String(t.name ?? '').trim();
                    return (
                      <option key={id} value={id}>
                        {name || id}
                      </option>
                    );
                  })}
                </select>
              </label>

              <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, padding: 12, background: '#F8FAFC' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Checklist</div>
                {!selectedRequestTemplate ? (
                  <div style={{ color: '#6b7280', fontSize: 13 }}>Select a template to see items.</div>
                ) : (
                  (() => {
                    const items = Array.isArray(selectedRequestTemplate.items) ? (selectedRequestTemplate.items as UnknownRecord[]) : [];
                    return items.length ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {items.map((it) => {
                          const id = String(it.id ?? '').trim();
                          const label = String(it.label ?? '').trim();
                          const checked = requestSelectedItemIds.includes(id);
                          return (
                            <label key={id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setRequestSelectedItemIds((prev) => {
                                    const s = new Set(prev);
                                    if (on) s.add(id);
                                    else s.delete(id);
                                    return [...s];
                                  });
                                }}
                              />
                              <span>{label || id}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: '#6b7280', fontSize: 13 }}>Template has no items.</div>
                    );
                  })()
                )}
              </div>

              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700, color: '#374151' }}>
                Note (optional)
                <textarea
                  rows={3}
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  placeholder="Please send these documents…"
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 12, padding: 10, boxSizing: 'border-box', fontSize: 14, resize: 'vertical' }}
                  disabled={busy.length > 0}
                />
              </label>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => setRequestModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  style={{ background: '#2563EB', color: '#fff', minWidth: 120 }}
                  disabled={
                    busy.length > 0 ||
                    !selectedThreadId ||
                    !canRun('create_docflow_document_request').enabled ||
                    !requestTemplateId.trim() ||
                    requestSelectedItemIds.length === 0
                  }
                  onClick={() =>
                    void runOfficeCommand('create_docflow_document_request', {
                      thread_id: selectedThreadId,
                      template_definition_id: requestTemplateId,
                      selected_definition_item_ids: requestSelectedItemIds,
                      ...(requestNote.trim() ? { note: requestNote.trim() } : {}),
                      idempotency_key: newDocflowIdempotencyKey(),
                    }).then(() => {
                      setRequestModalOpen(false);
                      setRequestNote('');
                    })
                  }
                >
                  Send Request
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

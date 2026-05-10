import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { newDocflowIdempotencyKey } from '../lib/idempotency-key';
import { docflowOfficeCommands, docflowOfficeMessengerAggregate, docflowStartOfficeThreadForClient } from '../api/endpoints';

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

export function DocflowMessengerPage() {
  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [composer, setComposer] = useState('');
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

  const actions = useMemo(() => {
    const list = clientContext?.allowed_actions;
    return Array.isArray(list) ? (list as AllowedAction[]) : [];
  }, [clientContext]);

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
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void loadMessenger({ clientId: id, threadId: null, searchClient: searchClientRef.current.trim() })}
                    style={{
                      width: '100%',
                      textAlign: 'start',
                      padding: '10px 12px',
                      border: 'none',
                      borderBottom: '1px solid #F1F5F9',
                      background: active ? '#EFF6FF' : '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>Threads: {String(c.active_thread_count ?? 0)}</div>
                    </div>
                    {unread > 0 ? (
                      <span style={{ minWidth: 22, height: 22, borderRadius: 11, background: '#22C55E', color: '#fff', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
                        {unread > 99 ? '99+' : unread}
                      </span>
                    ) : null}
                  </button>
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
                          {msgAttachments.map((a) => (
                            <div key={String(a.id ?? '')} style={{ fontSize: 12, color: '#334155' }}>
                              📎 {String(a.file_name ?? a.file_asset_id ?? '').trim()}
                            </div>
                          ))}
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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
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
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

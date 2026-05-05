import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiDocflowPortalJson, userFacingApiMessage } from '../api/client';
import {
  docflowPortalAttachFileToClientMessage,
  docflowPortalFileOpen,
  docflowPortalInboxAggregate,
  docflowPortalMarkThreadReadByClient,
  docflowPortalSendClientMessage,
} from '../api/endpoints';
import { redirectDocflowPortalToCanonicalHost } from '../lib/docflow-portal-host';
import { getDocflowPortalSessionToken } from '../lib/docflow-portal-session';

type UnknownRecord = Record<string, unknown>;

type AllowedAction = {
  command?: string;
  enabled?: boolean;
  reason?: string | null;
};

type CommandResponse = {
  ok?: boolean;
  refreshed?: { aggregate?: UnknownRecord };
};

export function ClientPortalDocflow() {
  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyCommand, setBusyCommand] = useState('');
  const [composer, setComposer] = useState('');
  const [attachFileAssetId, setAttachFileAssetId] = useState('');
  const [view, setView] = useState<'list' | 'thread'>('list');

  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [canShowInstallPrompt, setCanShowInstallPrompt] = useState(false);

  const loadAggregate = useCallback(
    async (selectedThreadId?: string | null): Promise<void> => {
      const token = getDocflowPortalSessionToken();
      if (!token) {
        setError('אין סשן פורטל. פתחו שוב את קישור ההזמנה מהמשרד.');
        setAggregate(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const out = (await apiDocflowPortalJson<UnknownRecord>(
          docflowPortalInboxAggregate(selectedThreadId ?? null),
          { method: 'GET' },
          token
        )) as UnknownRecord;
        if (String(out.aggregate_key ?? '') !== 'client_portal_inbox_aggregate') {
          throw new Error('תגובת השרת אינה אגרגט פורטל תקין');
        }
        setAggregate(out);
      } catch (e) {
        setError(userFacingApiMessage(e));
        setAggregate(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (redirectDocflowPortalToCanonicalHost()) return;
    void loadAggregate(null);
  }, [loadAggregate]);

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
    if (!a) return { enabled: false, reason: 'הפעולה אינה זמינה' };
    return { enabled: a.enabled !== false, reason: (a.reason as string | null) ?? null };
  }

  const pwaMeta = useMemo(() => {
    const raw = aggregate?.pwa_metadata;
    return raw && typeof raw === 'object' ? (raw as UnknownRecord) : null;
  }, [aggregate]);

  useEffect(() => {
    const n = Number(pwaMeta?.unread_count ?? aggregate?.unread_count);
    if (!Number.isFinite(n) || typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    const setAppBadge = (navigator as Navigator & { setAppBadge?: (c: number) => Promise<void> }).setAppBadge;
    if (typeof setAppBadge !== 'function') return;
    void (n > 0 ? setAppBadge.call(navigator, Math.min(99, Math.floor(n))) : setAppBadge.call(navigator, 0)).catch(() => {});
  }, [aggregate?.unread_count, pwaMeta]);

  const showA2hsHint = useMemo(() => {
    if (pwaMeta?.add_to_home_hint !== true) return false;
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return !window.matchMedia('(display-mode: standalone)').matches;
  }, [pwaMeta]);

  // PWA: beforeinstallprompt is browser-driven (no domain logic).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
      setCanShowInstallPrompt(true);
    };
    const onAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setCanShowInstallPrompt(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    if ('serviceWorker' in navigator) {
      // Register SW for installability/offline shell.
      void navigator.serviceWorker
        .register('/sw.js')
        .catch(() => {
          /* ignore - install can still work */
        });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  async function runCommand(command: string, payload: UnknownRecord): Promise<void> {
    const can = isCommandEnabled(command);
    if (!can.enabled) return;
    const token = getDocflowPortalSessionToken();
    if (!token) {
      setError('אין סשן פורטל.');
      return;
    }
    let path = '';
    if (command === 'send_client_message') path = docflowPortalSendClientMessage;
    else if (command === 'attach_file_to_client_message') path = docflowPortalAttachFileToClientMessage;
    else if (command === 'mark_thread_read_by_client') path = docflowPortalMarkThreadReadByClient;
    else return;
    setBusyCommand(command);
    setError('');
    try {
      const out = (await apiDocflowPortalJson<CommandResponse>(
        path,
        {
          method: 'POST',
          body: JSON.stringify({
            portal_session_token: token,
            ...payload,
          }),
        },
        token
      )) as CommandResponse;
      const refreshed = out.refreshed?.aggregate;
      if (!refreshed || typeof refreshed !== 'object') throw new Error('חסר אגרגט מעודכן מהשרת');
      if (String(refreshed.aggregate_key ?? '') !== 'client_portal_inbox_aggregate') {
        throw new Error('אגרגט מעודכן אינו תואם פורטל');
      }
      setAggregate(refreshed);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusyCommand('');
    }
  }

  async function openAttachment(fileAssetId: string): Promise<void> {
    const token = getDocflowPortalSessionToken();
    if (!token) {
      setError('אין סשן פורטל.');
      return;
    }
    setError('');
    try {
      const out = (await apiDocflowPortalJson<{ url?: string }>(
        docflowPortalFileOpen(fileAssetId),
        { method: 'GET' },
        token
      )) as { url?: string };
      const url = typeof out.url === 'string' ? out.url : '';
      if (!url) throw new Error('חסר קישור מאובטח להורדה');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  }

  const firmTitle = String((aggregate?.firm_header as UnknownRecord | undefined)?.title ?? 'DocFlow');
  const clientName = String((aggregate?.client_profile_header as UnknownRecord | undefined)?.display_name ?? '');
  const totalUnread = Number(aggregate?.unread_count ?? 0);
  const emptyStates = (aggregate?.empty_states as UnknownRecord | undefined) ?? null;
  const attachPerm = (aggregate?.attachment_permissions as UnknownRecord | undefined)?.can_attach === true;

  if (!getDocflowPortalSessionToken() && !loading) {
    return (
      <div style={{ minHeight: '100dvh', padding: 16, fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>DocFlow</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>אין סשן פורטל. פתחו את קישור ההזמנה שנשלח אליכם מהמשרד.</p>
      </div>
    );
  }

  if (loading && !aggregate) {
    return (
      <div style={{ minHeight: '100dvh', padding: 16, fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '0 auto' }}>
        <p style={{ color: '#6b7280', margin: 0 }}>טוען…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 520,
        margin: '0 auto',
        background: '#f9fafb',
      }}
      dir="rtl"
      lang="he"
    >
      <header
        style={{
          padding: '12px 16px',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{firmTitle}</div>
          {clientName ? <div style={{ fontSize: 13, color: '#6b7280' }}>{clientName}</div> : null}
        </div>
        {Number.isFinite(totalUnread) && totalUnread > 0 ? (
          <span
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 11,
              background: '#2563eb',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 6px',
            }}
            aria-label="Unread messages"
          >
            {totalUnread > 99 ? '99+' : String(totalUnread)}
          </span>
        ) : null}
      </header>

      {showA2hsHint ? (
        <div style={{ padding: '8px 16px', fontSize: 13, color: '#374151', background: '#fef3c7', borderBottom: '1px solid #fde68a' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>ניתן להוסיף את DocFlow למסך הבית בטלפון</div>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            style={{ background: '#2563EB', color: '#fff', borderRadius: 8, border: 'none' }}
            disabled={!canShowInstallPrompt || !deferredInstallPrompt}
            onClick={async () => {
              try {
                if (!deferredInstallPrompt) return;
                deferredInstallPrompt.prompt();
                await deferredInstallPrompt.userChoice;
                setDeferredInstallPrompt(null);
                setCanShowInstallPrompt(false);
              } catch {
                // ignore - user will decide in browser UI.
              }
            }}
          >
            הוסף למסך הבית
          </button>
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '8px 16px', color: '#b91c1c', fontSize: 14, background: '#fef2f2' }}>{error}</div>
      ) : null}

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {view === 'list' ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {emptyStates?.no_threads === true ? (
              <p style={{ color: '#6b7280', padding: 12 }}>אין שיחות עדיין.</p>
            ) : (
              threadList.map((t) => {
                const id = String(t.id ?? '');
                const unread = Number(t.unread_count ?? 0);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setView('thread');
                      void loadAggregate(id);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'start',
                      padding: '12px 14px',
                      marginBottom: 8,
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{String(t.thread_type_label ?? t.thread_type ?? '')}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{String(t.thread_status_label ?? '')}</div>
                    {unread > 0 ? (
                      <div style={{ fontSize: 12, color: '#2563eb', marginTop: 4 }}>לא נקראו: {unread}</div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                onClick={() => {
                  setView('list');
                  void loadAggregate(null);
                }}
                style={{ marginBottom: 8 }}
              >
                חזרה לרשימה
              </button>
              <div style={{ fontWeight: 700 }}>{String(selectedThread?.thread_type_label ?? '')}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{String(selectedThread?.thread_status_label ?? '')}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                SLA: {String((selectedThread?.sla_indicator as UnknownRecord | undefined)?.label ?? '—')}
              </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
              {!selectedThreadId ? (
                <p style={{ color: '#6b7280' }}>בחרו שיחה מהרשימה.</p>
              ) : emptyStates?.no_messages === true ? (
                <p style={{ color: '#6b7280' }}>אין הודעות בשיחה זו.</p>
              ) : (
                messages.map((m) => (
                  <div
                    key={String(m.id ?? '')}
                    style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8, background: '#fff' }}
                  >
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {String(m.created_by_type ?? '')} · {String(m.created_at ?? '')}
                    </div>
                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{String(m.body ?? '')}</div>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      {attachments
                        .filter((a) => String(a.message_id ?? '') === String(m.id ?? ''))
                        .map((a) => {
                          const fid = String(a.file_asset_id ?? '');
                          const label = String(a.file_name ?? '').trim() || fid.slice(0, 8);
                          return (
                            <div key={String(a.id ?? fid)} style={{ marginTop: 4 }}>
                              <button
                                type="button"
                                className="nx-btn nx-btn-taxes-compact"
                                style={{ fontSize: 13 }}
                                onClick={() => void openAttachment(fid)}
                              >
                                הורדה: {label}
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: 10, borderTop: '1px solid #e5e7eb', background: '#fff', display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={!isCommandEnabled('mark_thread_read_by_client').enabled || !selectedThreadId || busyCommand.length > 0}
                  onClick={() => void runCommand('mark_thread_read_by_client', { thread_id: selectedThreadId })}
                >
                  סימון כנקרא
                </button>
              </div>
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder="כתבו הודעה…"
                rows={3}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: 8, boxSizing: 'border-box', fontSize: 15 }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={
                    !isCommandEnabled('send_client_message').enabled || !selectedThreadId || !composer.trim() || busyCommand.length > 0
                  }
                  onClick={() =>
                    void runCommand('send_client_message', {
                      thread_id: selectedThreadId,
                      message_type: 'text',
                      body: composer.trim(),
                    }).then(() => setComposer(''))
                  }
                >
                  שליחה
                </button>
              </div>
              {attachPerm && isCommandEnabled('attach_file_to_client_message').enabled ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    value={attachFileAssetId}
                    onChange={(e) => setAttachFileAssetId(e.target.value)}
                    placeholder="מזהה קובץ (file_asset_id)"
                    style={{ flex: 1, minWidth: 160, padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
                  />
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={!selectedThreadId || !attachFileAssetId.trim() || busyCommand.length > 0}
                    onClick={() => {
                      const lastMsgId = String(messages[messages.length - 1]?.id ?? '');
                      if (!lastMsgId) return;
                      void runCommand('attach_file_to_client_message', {
                        thread_id: selectedThreadId,
                        message_id: lastMsgId,
                        file_asset_id: attachFileAssetId.trim(),
                      }).then(() => setAttachFileAssetId(''));
                    }}
                  >
                    צירוף קובץ
                  </button>
                  <div style={{ width: '100%', fontSize: 12, color: '#6b7280' }}>
                    Mobile direct upload is pending shared portal file-upload service; current flow expects `file_asset_id`.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

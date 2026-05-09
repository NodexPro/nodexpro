import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiDocflowPortalJson, userFacingApiMessage } from '../api/client';
import {
  docflowPortalAttachFileToClientMessage,
  docflowPortalFileOpen,
  docflowPortalInboxAggregate,
  docflowPortalMarkThreadReadByClient,
  docflowPortalStartClientThread,
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
  const [isNarrowLayout, setIsNarrowLayout] = useState(false);
  const [showEmptyDraftComposer, setShowEmptyDraftComposer] = useState(false);

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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsNarrowLayout(media.matches);
    apply();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

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
    if (command === 'start_client_portal_thread') path = docflowPortalStartClientThread;
    else if (command === 'send_client_message') path = docflowPortalSendClientMessage;
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
  const firmLogoUrl = String((aggregate?.firm_header as UnknownRecord | undefined)?.logo_url ?? '').trim() || null;
  const clientName = String((aggregate?.client_profile_header as UnknownRecord | undefined)?.display_name ?? '');
  const totalUnread = Number(aggregate?.unread_count ?? 0);
  const emptyStates = (aggregate?.empty_states as UnknownRecord | undefined) ?? null;
  const attachPerm = (aggregate?.attachment_permissions as UnknownRecord | undefined)?.can_attach === true;
  const selectedThreadTitle = String(selectedThread?.thread_type_label ?? selectedThread?.thread_type ?? '').trim();
  const selectedThreadStatusLabel = String(selectedThread?.thread_status_label ?? '').trim();
  const selectedThreadSlaLabel = String((selectedThread?.sla_indicator as UnknownRecord | undefined)?.label ?? '').trim();
  const hasThreads = threadList.length > 0 && emptyStates?.no_threads !== true;
  const startThreadAction = isCommandEnabled('start_client_portal_thread');

  function initials(value: string): string {
    const clean = String(value ?? '').trim();
    if (!clean) return 'D';
    return clean.slice(0, 1).toUpperCase();
  }

  function fmtTs(v: unknown): string {
    const s = String(v ?? '').trim();
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

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
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 1180,
        margin: '0 auto',
        background: '#0b1020',
        color: '#E5E7EB',
        padding: 12,
      }}
      dir="rtl"
      lang="he"
    >
      <header
        style={{
          padding: '12px 14px',
          background: 'linear-gradient(180deg, #132B66 0%, #0E1E45 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {firmLogoUrl ? (
            <img
              src={firmLogoUrl}
              alt={firmTitle}
              style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.2)' }}
            />
          ) : (
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 13,
                background: 'rgba(255,255,255,0.16)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              {initials(firmTitle)}
            </div>
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>{firmTitle}</div>
            {clientName ? <div style={{ fontSize: 12.5, color: '#B8C3DC' }}>{clientName}</div> : null}
          </div>
        </div>
        {Number.isFinite(totalUnread) && totalUnread > 0 ? (
          <span
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 11,
              background: '#22C55E',
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
        <div style={{ padding: '8px 12px', fontSize: 13, color: '#111827', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>ניתן להוסיף את DocFlow למסך הבית בטלפון</div>
          {canShowInstallPrompt && deferredInstallPrompt ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              style={{ background: '#2563EB', color: '#fff', borderRadius: 8, border: 'none' }}
              onClick={async () => {
                try {
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
          ) : (
            <div style={{ fontSize: 12, color: '#7C5E10' }}>
              אם הכפתור לא מוצג, פתחו בתפריט הדפדפן ובחרו "Add to Home Screen".
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '8px 12px', color: '#991B1B', fontSize: 14, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, marginBottom: 8 }}>{error}</div>
      ) : null}

      <main style={{ display: 'flex', flex: 1, gap: 10, minHeight: 'calc(100dvh - 120px)' }}>
        <aside
          style={{
            width: isNarrowLayout ? '100%' : view === 'thread' ? 0 : 'min(340px, 100%)',
            display: view === 'thread' ? 'none' : 'flex',
            flexDirection: 'column',
            minWidth: 0,
            background: '#0F172A',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: 13, color: '#93C5FD' }}>
            שיחות
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {emptyStates?.no_threads === true ? (
              <p style={{ color: '#94A3B8', padding: 12 }}>אין שיחות עדיין.</p>
            ) : (
              threadList.map((t) => {
                const id = String(t.id ?? '');
                const unread = Number(t.unread_count ?? 0);
                const isActive = selectedThreadId === id;
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
                      padding: '11px 12px',
                      marginBottom: 8,
                      border: isActive ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10,
                      background: isActive ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.03)',
                      color: '#E5E7EB',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{String(t.thread_type_label ?? t.thread_type ?? '')}</div>
                    <div style={{ fontSize: 12, color: '#93A5C6', marginTop: 2 }}>{String(t.thread_status_label ?? '')}</div>
                    {unread > 0 ? (
                      <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#34D399' }}>
                        <span style={{ width: 7, height: 7, borderRadius: 99, background: '#34D399', display: 'inline-block' }} />
                        {unread > 99 ? '99+' : unread} חדשות
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section
          style={{
            display: isNarrowLayout && view !== 'thread' ? 'none' : 'flex',
            flex: 1,
            minWidth: 0,
            flexDirection: 'column',
            borderRadius: 14,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.12)',
            background: '#EEF2F7',
            color: '#111827',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid #D6DCE8',
              background: '#F8FAFC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedThreadTitle || 'בחרו שיחה'}</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                {[selectedThreadStatusLabel, selectedThreadSlaLabel ? `SLA: ${selectedThreadSlaLabel}` : ''].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {selectedThreadId ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={!isCommandEnabled('mark_thread_read_by_client').enabled || busyCommand.length > 0}
                  onClick={() => void runCommand('mark_thread_read_by_client', { thread_id: selectedThreadId })}
                >
                  נקרא
                </button>
              ) : null}
              {view === 'thread' ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  onClick={() => {
                    setView('list');
                    void loadAggregate(null);
                  }}
                >
                  שיחות
                </button>
              ) : null}
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '12px 10px', background: '#E9EEF5' }}>
            {!selectedThreadId ? (
              hasThreads ? (
                <p style={{ color: '#6B7280', margin: 10 }}>בחרו שיחה מהרשימה.</p>
              ) : (
                <div style={{ margin: 10, display: 'grid', gap: 10 }}>
                  <div style={{ color: '#6B7280', fontSize: 15, fontWeight: 600 }}>עדיין אין שיחות</div>
                  <div style={{ color: '#64748B', fontSize: 13.5 }}>שלחו הודעה ראשונה למשרד</div>
                  {!showEmptyDraftComposer ? (
                    <button
                      type="button"
                      className="nx-btn nx-btn-taxes-compact"
                      style={{ width: 'fit-content' }}
                      onClick={() => setShowEmptyDraftComposer(true)}
                    >
                      שלחו הודעה ראשונה
                    </button>
                  ) : (
                    <div
                      style={{
                        display: 'grid',
                        gap: 8,
                        padding: 10,
                        background: '#fff',
                        border: '1px solid #D6DCE8',
                        borderRadius: 10,
                        maxWidth: 560,
                      }}
                    >
                      <textarea
                        value={composer}
                        onChange={(e) => setComposer(e.target.value)}
                        placeholder="כתבו הודעה…"
                        rows={3}
                        style={{
                          width: '100%',
                          border: '1px solid #CBD5E1',
                          borderRadius: 10,
                          padding: 10,
                          boxSizing: 'border-box',
                          fontSize: 14,
                          resize: 'vertical',
                          background: '#fff',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="nx-btn nx-btn-taxes-compact"
                          style={{ minWidth: 96 }}
                          disabled={!startThreadAction.enabled || !composer.trim() || busyCommand.length > 0}
                          title={startThreadAction.reason ?? undefined}
                          onClick={() =>
                            void runCommand('start_client_portal_thread', {
                              message_text: composer.trim(),
                            }).then(() => {
                              setComposer('');
                              setShowEmptyDraftComposer(false);
                              setView('thread');
                            })
                          }
                        >
                          שליחה
                        </button>
                        <button
                          type="button"
                          className="nx-btn nx-btn-taxes-compact"
                          onClick={() => {
                            setShowEmptyDraftComposer(false);
                            setComposer('');
                          }}
                        >
                          ביטול
                        </button>
                        {!startThreadAction.enabled ? (
                          <span style={{ fontSize: 12, color: '#64748B' }}>{startThreadAction.reason ?? 'הפעולה אינה זמינה'}</span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : emptyStates?.no_messages === true ? (
              <p style={{ color: '#6B7280', margin: 10 }}>אין הודעות בשיחה זו.</p>
            ) : (
              messages.map((m) => {
                const id = String(m.id ?? '');
                const by = String(m.created_by_type ?? '');
                const mine = by === 'client';
                const msgAttachments = attachments.filter((a) => String(a.message_id ?? '') === id);
                return (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      justifyContent: mine ? 'flex-end' : 'flex-start',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '82%',
                        borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        background: mine ? '#D1FAE5' : '#FFFFFF',
                        border: mine ? '1px solid #A7F3D0' : '1px solid #E5E7EB',
                        padding: '8px 10px',
                        boxShadow: '0 1px 1px rgba(0,0,0,0.05)',
                      }}
                    >
                      <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', lineHeight: 1.35, fontSize: 14.2 }}>{String(m.body ?? '')}</div>
                      {msgAttachments.length > 0 ? (
                        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                          {msgAttachments.map((a) => {
                            const fid = String(a.file_asset_id ?? '');
                            const label = String(a.file_name ?? '').trim() || fid.slice(0, 8);
                            return (
                              <button
                                key={String(a.id ?? fid)}
                                type="button"
                                className="nx-btn nx-btn-taxes-compact"
                                style={{ fontSize: 12.5, justifySelf: 'start' }}
                                onClick={() => void openAttachment(fid)}
                              >
                                קובץ: {label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <div style={{ marginTop: 6, fontSize: 11, color: '#6B7280', textAlign: mine ? 'left' : 'right' }}>{fmtTs(m.created_at)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {selectedThreadId ? (
            <div style={{ padding: 10, borderTop: '1px solid #D6DCE8', background: '#F8FAFC', display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="כתבו הודעה…"
                  rows={2}
                  style={{ width: '100%', border: '1px solid #CBD5E1', borderRadius: 12, padding: 10, boxSizing: 'border-box', fontSize: 15, resize: 'vertical', background: '#fff' }}
                />
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  style={{ minWidth: 86 }}
                  disabled={!isCommandEnabled('send_client_message').enabled || !composer.trim() || busyCommand.length > 0}
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
                    style={{ flex: 1, minWidth: 150, padding: 8, border: '1px solid #CBD5E1', borderRadius: 10, fontSize: 13.5, background: '#fff' }}
                  />
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={!attachFileAssetId.trim() || busyCommand.length > 0}
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
                    📎 צרף
                  </button>
                  <div style={{ width: '100%', fontSize: 11.5, color: '#64748B' }}>
                    Mobile upload uses existing `file_asset_id` flow from backend aggregate/commands.
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ padding: 10, borderTop: '1px solid #D6DCE8', background: '#F8FAFC', fontSize: 13, color: '#64748B' }}>
              {hasThreads
                ? 'בחרו שיחה מהרשימה כדי לכתוב הודעה או לצרף קובץ.'
                : 'אין שיחות פתוחות כרגע. כשהמשרד יפתח שיחה חדשה - היא תופיע כאן.'}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

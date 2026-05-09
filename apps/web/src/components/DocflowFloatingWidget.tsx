import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../api/client';
import { docflowFloatingWidgetAggregate, docflowOfficeCommands } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import './DocflowFloatingWidget.css';

type UnknownRecord = Record<string, unknown>;

type AllowedAction = { command?: string; enabled?: boolean; reason?: string | null };

const REVIEW_ACTION_KEYS = new Set([
  'edit_draft_message',
  'approve_draft_message',
  'send_approved_message',
  'cancel_draft_message',
]);

type PendingDraft = {
  draft_id?: string;
  client_id?: string;
  client_name?: string | null;
  rule_name?: string | null;
  rule_value_key?: string | null;
  message_body?: string;
  message_preview?: string;
  status?: string;
  status_label?: string;
  created_at?: string | null;
  client_display_name?: string | null;
  preview_text?: string;
  generated_at_display?: string;
  generated_at?: string | null;
  command_context?: UnknownRecord;
  allowed_actions?: AllowedAction[];
};

function isRecord(v: unknown): v is UnknownRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function draftAction(d: PendingDraft, command: string): { ok: boolean; reason: string | null } {
  const list = Array.isArray(d.allowed_actions) ? d.allowed_actions : [];
  const hit = list.find((a) => String(a.command ?? '') === command);
  if (!hit) return { ok: false, reason: null };
  return { ok: !!hit.enabled, reason: hit.reason ?? null };
}

function hasDraftAction(d: PendingDraft, command: string): boolean {
  const list = Array.isArray(d.allowed_actions) ? d.allowed_actions : [];
  return list.some((a) => String(a.command ?? '') === command);
}

function hasAnyReviewAction(d: PendingDraft): boolean {
  const list = Array.isArray(d.allowed_actions) ? d.allowed_actions : [];
  return list.some((a) => REVIEW_ACTION_KEYS.has(String(a.command ?? '')));
}

function draftRowKey(d: PendingDraft, idx: number): string {
  const id = String(d.draft_id ?? '').trim();
  if (id) return id;
  const ctx = d.command_context;
  if (isRecord(ctx)) {
    return `${String(ctx.draft_id ?? '')}-${String(ctx.rule_run_id ?? '')}-${idx}`;
  }
  return `row-${idx}`;
}

function reasonCellText(d: PendingDraft): string {
  const preview = String(d.message_preview ?? '').trim();
  if (preview) return preview;
  const pt = String(d.preview_text ?? '').trim();
  if (pt) return pt;
  return String(d.rule_name ?? d.rule_value_key ?? '').trim();
}

export function DocflowFloatingWidget() {
  const navigate = useNavigate();
  const auth = useAuth();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailEditing, setDetailEditing] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [cancelConfirmDraft, setCancelConfirmDraft] = useState<PendingDraft | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) {
      setAggregate(null);
      return;
    }
    setLoadError('');
    try {
      const data = (await apiJson(docflowFloatingWidgetAggregate)) as UnknownRecord;
      setAggregate(data);
    } catch (e) {
      setAggregate(null);
      setLoadError(userFacingApiMessage(e));
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCommand = useCallback(
    async (command: string, ctx: UnknownRecord): Promise<void> => {
      if (!orgId) return;
      setBusy(command);
      setActionError('');
      try {
        const out = (await apiJson(docflowOfficeCommands, {
          method: 'POST',
          body: JSON.stringify({
            command,
            payload: {
              org_id: orgId,
              ...ctx,
              refresh_aggregate: 'docflow_floating_widget_aggregate',
            },
          }),
        })) as { refreshed?: { aggregate_key?: string; aggregate?: UnknownRecord } };
        const key = out.refreshed?.aggregate_key;
        const agg = out.refreshed?.aggregate;
        if (key !== 'docflow_floating_widget_aggregate' || !isRecord(agg)) {
          throw new Error('DocFlow widget aggregate missing in command response');
        }
        setAggregate(agg);
      } catch (e) {
        setActionError(userFacingApiMessage(e));
      } finally {
        setBusy('');
      }
    },
    [orgId]
  );

  const visibility = String(aggregate?.widget_visibility ?? '');
  const badgeRing = String(aggregate?.badge_ring ?? '');
  const badgeModifierClass =
    badgeRing === 'trial_active'
      ? 'docflow-badge--trial'
      : badgeRing === 'active_paid'
        ? 'docflow-badge--paid'
        : 'docflow-badge--locked';
  const widgetAccess = String(aggregate?.widget_access ?? '');
  const trialBadge = aggregate?.trial_badge_label != null ? String(aggregate.trial_badge_label) : '';
  const trialDetail = aggregate?.trial_detail_line != null ? String(aggregate.trial_detail_line) : '';
  const lockedMessage = aggregate?.locked_message != null ? String(aggregate.locked_message) : '';
  const billingCta = aggregate?.billing_cta_label != null ? String(aggregate.billing_cta_label) : 'Go to billing';
  const billingPath = aggregate?.billing_path != null ? String(aggregate.billing_path) : '/billing';
  const countRaw = aggregate?.pending_draft_count;
  const pendingCount = typeof countRaw === 'number' ? countRaw : Number(countRaw) || 0;
  const draftsRaw = aggregate?.pending_drafts;
  const drafts: PendingDraft[] = Array.isArray(draftsRaw) ? (draftsRaw as PendingDraft[]) : [];

  const ruleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of drafts) {
      const label = String(d.rule_name ?? d.rule_value_key ?? '').trim();
      if (label) set.add(label);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [drafts]);

  const filteredDrafts = useMemo(() => {
    let list = drafts;
    if (ruleFilter !== 'all') {
      list = list.filter((d) => {
        const label = String(d.rule_name ?? d.rule_value_key ?? '').trim();
        return label === ruleFilter;
      });
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((d) => {
      const blob = [
        d.client_name,
        d.client_display_name,
        d.rule_name,
        d.rule_value_key,
        d.message_preview,
        d.preview_text,
        d.status_label,
        d.generated_at_display,
      ]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(q);
    });
  }, [drafts, ruleFilter, searchQuery]);

  const selectedDraft = useMemo(() => {
    if (!selectedDraftId) return null;
    return filteredDrafts.find((d) => String(d.draft_id ?? '') === selectedDraftId) ?? null;
  }, [filteredDrafts, selectedDraftId]);

  useEffect(() => {
    if (!selectedDraftId) return;
    if (!filteredDrafts.some((d) => String(d.draft_id ?? '') === selectedDraftId)) {
      setSelectedDraftId(null);
      setDetailEditing(false);
      setEditBody('');
    }
  }, [filteredDrafts, selectedDraftId]);

  useEffect(() => {
    setDetailEditing(false);
    setEditBody('');
  }, [selectedDraftId]);

  useEffect(() => {
    setCancelConfirmDraft(null);
  }, [selectedDraftId]);

  useEffect(() => {
    if (!tasksModalOpen) {
      setCancelConfirmDraft(null);
    }
  }, [tasksModalOpen]);

  useEffect(() => {
    if (!menuOpen && !tasksModalOpen && !cancelConfirmDraft) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (cancelConfirmDraft) {
        setCancelConfirmDraft(null);
        return;
      }
      if (tasksModalOpen) {
        setTasksModalOpen(false);
        return;
      }
      setMenuOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, tasksModalOpen, cancelConfirmDraft]);

  async function runDraftCommand(command: string, d: PendingDraft, extra?: UnknownRecord): Promise<void> {
    const ctx = isRecord(d.command_context) ? d.command_context : {};
    await runCommand(command, { ...ctx, ...(extra ?? {}) });
  }

  function closeMenu(): void {
    setMenuOpen(false);
  }

  function closeTasksModal(): void {
    setTasksModalOpen(false);
  }

  function openTasksFromMenu(): void {
    closeMenu();
    setTasksModalOpen(true);
  }

  function goMessenger(): void {
    closeMenu();
    navigate('/m/docflow/messenger');
  }

  function onFabClick(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    if (tasksModalOpen) {
      if (cancelConfirmDraft) {
        setCancelConfirmDraft(null);
        return;
      }
      closeTasksModal();
      return;
    }
    setMenuOpen((v) => !v);
  }

  if (!orgId || visibility !== 'visible') {
    return null;
  }

  const detailDisplayClient =
    String(selectedDraft?.client_name ?? selectedDraft?.client_display_name ?? '').trim() || '—';
  const detailRuleName = String(selectedDraft?.rule_name ?? selectedDraft?.rule_value_key ?? '').trim() || '—';
  const detailDue =
    String(selectedDraft?.generated_at_display ?? '').trim() ||
    String(selectedDraft?.created_at ?? '').trim().replace('T', ' ').slice(0, 16) ||
    '—';
  const detailStatus =
    String(selectedDraft?.status_label ?? '').trim() || String(selectedDraft?.status ?? '').trim() || '—';

  const cancelConfirmClientName =
    cancelConfirmDraft != null
      ? String(cancelConfirmDraft.client_name ?? cancelConfirmDraft.client_display_name ?? '').trim() || 'this client'
      : '';

  const menuOrModalOpen = menuOpen || tasksModalOpen;

  return (
    <>
      {menuOpen && !tasksModalOpen ? (
        <button
          type="button"
          className="docflow-menu-backdrop"
          aria-label="Close DocFlow menu"
          onMouseDown={(e) => {
            e.preventDefault();
            closeMenu();
          }}
        />
      ) : null}

      {tasksModalOpen ? (
        <button
          type="button"
          className="docflow-tasks-modal-backdrop"
          aria-label="Close DocFlow tasks"
          onMouseDown={(e) => {
            e.preventDefault();
            if (cancelConfirmDraft) {
              setCancelConfirmDraft(null);
              return;
            }
            closeTasksModal();
          }}
        />
      ) : null}

      <div className="nx-docflow-widget-root">
        {menuOpen && !tasksModalOpen ? (
          <div
            className="docflow-bubble-menu"
            role="menu"
            aria-label="DocFlow actions"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="docflow-bubble-menu-title">DocFlow</div>
            <div className="docflow-bubble-menu-subtitle">
              {pendingCount} pending draft{pendingCount === 1 ? '' : 's'}
            </div>
            <button type="button" className="docflow-bubble-menu-btn docflow-bubble-menu-btn-primary" onClick={openTasksFromMenu}>
              Open Tasks
            </button>
            <button type="button" className="docflow-bubble-menu-btn docflow-bubble-menu-btn-secondary" onClick={goMessenger}>
              Open Messenger
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="nx-docflow-widget-fab"
          aria-label="DocFlow"
          aria-expanded={menuOrModalOpen}
          aria-haspopup="true"
          onClick={onFabClick}
        >
          <div className={`docflow-badge ${badgeModifierClass}`}>
            <div className="docflow-text-top">• DocFlow • DocFlow •</div>
            <img src="/docflow-logo.png" className="docflow-logo" alt="" />
            <div className="docflow-text-bottom">• DocFlow •</div>
          </div>
          {pendingCount > 0 ? <span className="nx-docflow-widget-count">{pendingCount > 99 ? '99+' : pendingCount}</span> : null}
        </button>
      </div>

      {tasksModalOpen ? (
        <div className="docflow-tasks-modal-wrap" role="dialog" aria-modal="true" aria-labelledby="docflow-tasks-modal-title">
          <div className="docflow-tasks-modal">
            <div className="docflow-tasks-modal-header">
              <div>
                <div id="docflow-tasks-modal-title" className="docflow-tasks-modal-title">
                  DocFlow Tasks
                </div>
                <div className="docflow-tasks-modal-subtitle">
                  {pendingCount} pending draft{pendingCount === 1 ? '' : 's'}
                </div>
                {trialBadge ? (
                  <div className="docflow-task-trial">
                    {trialBadge}
                    {trialDetail ? <div className="docflow-task-trial-detail">{trialDetail}</div> : null}
                  </div>
                ) : null}
              </div>
              <button type="button" className="docflow-task-close" onClick={closeTasksModal} aria-label="Close">
                ×
              </button>
            </div>

            {widgetAccess === 'locked' ? (
              <div className="docflow-task-locked">
                {lockedMessage ? <p className="docflow-task-locked-msg">{lockedMessage}</p> : null}
                <Link
                  className="docflow-btn docflow-btn-send"
                  to={billingPath}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
                >
                  {billingCta}
                </Link>
                <Link
                  to="/m/docflow/messenger"
                  className="docflow-task-messenger-link docflow-task-messenger-link--block"
                  onClick={() => closeTasksModal()}
                >
                  Open Messenger
                </Link>
              </div>
            ) : (
              <>
                <div className="docflow-task-controls">
                  <select
                    className="docflow-task-select"
                    value={ruleFilter}
                    onChange={(e) => setRuleFilter(e.target.value)}
                    aria-label="Filter by rule"
                  >
                    <option value="all">All rules</option>
                    {ruleOptions.map((r) => (
                      <option key={r} value={r}>
                        {r.length > 36 ? `${r.slice(0, 35)}…` : r}
                      </option>
                    ))}
                  </select>
                  <input
                    className="docflow-task-search"
                    type="search"
                    placeholder="Search tasks…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search tasks"
                  />
                </div>

                <div className="docflow-tasks-modal-body">
                  {pendingCount === 0 || drafts.length === 0 ? (
                    <div className="docflow-task-empty">
                      No pending drafts
                      <div className="docflow-task-empty-muted">New communication drafts will appear here.</div>
                    </div>
                  ) : filteredDrafts.length === 0 ? (
                    <div className="docflow-task-empty">
                      No matching tasks
                      <div className="docflow-task-empty-muted">Try another rule filter or search.</div>
                    </div>
                  ) : (
                    <div className="docflow-draft-card-list">
                      {filteredDrafts.map((d, idx) => {
                        const id = String(d.draft_id ?? '').trim();
                        const client = String(d.client_name ?? d.client_display_name ?? '').trim() || '—';
                        const rule = String(d.rule_name ?? d.rule_value_key ?? '').trim() || '—';
                        const reason = reasonCellText(d) || '—';
                        const statusLabel =
                          String(d.status_label ?? '').trim() || String(d.status ?? '').trim() || '—';
                        const due =
                          String(d.generated_at_display ?? '').trim() ||
                          String(d.created_at ?? '').trim().replace('T', ' ').slice(0, 16) ||
                          '—';
                        const selected = id && selectedDraftId === id;
                        const showReview = hasAnyReviewAction(d);
                        return (
                          <div
                            key={draftRowKey(d, idx)}
                            className={`docflow-draft-card${selected ? ' docflow-draft-card-selected' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedDraftId(id || null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedDraftId(id || null);
                              }
                            }}
                          >
                            <div className="docflow-draft-card-top">
                              <span className="docflow-draft-card-client">{client}</span>
                              <span className="docflow-status-pill" title={statusLabel}>
                                {statusLabel}
                              </span>
                            </div>
                            <div className="docflow-draft-card-rule">{rule}</div>
                            <div className="docflow-draft-card-reason">{reason}</div>
                            <div className="docflow-draft-card-meta">
                              <span>{due}</span>
                              {showReview ? (
                                <button
                                  type="button"
                                  className="docflow-review-btn"
                                  disabled={busy.length > 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDraftId(id || null);
                                  }}
                                >
                                  Review
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedDraft && widgetAccess !== 'locked' ? (
                    <div className="docflow-detail-card">
                      <div className="docflow-detail-meta docflow-detail-meta-compact">
                        <div>
                          <span className="docflow-detail-meta-key">Client</span>
                          <span className="docflow-detail-meta-val">{detailDisplayClient}</span>
                        </div>
                        <div>
                          <span className="docflow-detail-meta-key">Rule</span>
                          <span className="docflow-detail-meta-val">{detailRuleName}</span>
                        </div>
                        <div>
                          <span className="docflow-detail-meta-key">Generated</span>
                          <span className="docflow-detail-meta-val">{detailDue}</span>
                        </div>
                        <div>
                          <span className="docflow-detail-meta-key">Status</span>
                          <span className="docflow-detail-meta-val">{detailStatus}</span>
                        </div>
                      </div>

                      {detailEditing && hasDraftAction(selectedDraft, 'edit_draft_message') ? (
                        <div className="docflow-edit-block">
                          <textarea
                            className="docflow-edit-textarea"
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            disabled={busy.length > 0}
                            aria-label="Edit message body"
                          />
                          <div className="docflow-edit-actions">
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-edit docflow-btn-edit-wide"
                              disabled={busy.length > 0}
                              onClick={() => {
                                setDetailEditing(false);
                                setEditBody(String(selectedDraft.message_body ?? ''));
                              }}
                            >
                              Discard
                            </button>
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-approve docflow-btn-edit-wide"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'edit_draft_message').ok}
                              title={draftAction(selectedDraft, 'edit_draft_message').reason ?? undefined}
                              onClick={() =>
                                void runDraftCommand('edit_draft_message', selectedDraft, {
                                  message_body: editBody,
                                }).then(() => {
                                  setDetailEditing(false);
                                  setEditBody('');
                                })
                              }
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="docflow-message-preview">
                          {String(selectedDraft.message_body ?? '').trim() ||
                            String(selectedDraft.message_preview ?? selectedDraft.preview_text ?? '').trim() ||
                            '—'}
                        </div>
                      )}

                      {!detailEditing ? (
                        <div className="docflow-action-bar">
                          {hasDraftAction(selectedDraft, 'edit_draft_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-edit"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'edit_draft_message').ok}
                              title={draftAction(selectedDraft, 'edit_draft_message').reason ?? undefined}
                              onClick={() => {
                                setDetailEditing(true);
                                setEditBody(String(selectedDraft.message_body ?? ''));
                              }}
                            >
                              Edit
                            </button>
                          ) : null}
                          {hasDraftAction(selectedDraft, 'approve_draft_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-approve"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'approve_draft_message').ok}
                              title={draftAction(selectedDraft, 'approve_draft_message').reason ?? undefined}
                              onClick={() => void runDraftCommand('approve_draft_message', selectedDraft)}
                            >
                              Approve
                            </button>
                          ) : null}
                          {hasDraftAction(selectedDraft, 'send_approved_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-send"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'send_approved_message').ok}
                              title={draftAction(selectedDraft, 'send_approved_message').reason ?? undefined}
                              onClick={() => void runDraftCommand('send_approved_message', selectedDraft)}
                            >
                              Send
                            </button>
                          ) : null}
                          {hasDraftAction(selectedDraft, 'cancel_draft_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-cancel"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'cancel_draft_message').ok}
                              title={draftAction(selectedDraft, 'cancel_draft_message').reason ?? undefined}
                              onClick={() => setCancelConfirmDraft(selectedDraft)}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            )}

            {loadError ? <div className="docflow-task-error">{loadError}</div> : null}
            {actionError ? <div className="docflow-task-error">{actionError}</div> : null}
          </div>
        </div>
      ) : null}

      {cancelConfirmDraft && tasksModalOpen ? (
        <>
          <button
            type="button"
            className="docflow-confirm-backdrop"
            aria-label="Close confirmation"
            onMouseDown={(e) => {
              e.preventDefault();
              setCancelConfirmDraft(null);
            }}
          />
          <div
            className="docflow-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="docflow-cancel-confirm-title"
            aria-describedby="docflow-cancel-confirm-desc"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="docflow-cancel-confirm-title" className="docflow-confirm-title">
              Cancel reminder?
            </h2>
            <p id="docflow-cancel-confirm-desc" className="docflow-confirm-text">
              Are you sure you want to cancel this reminder for {cancelConfirmClientName}? After cancellation, this
              reminder will not appear again for this client until the next payroll period/month.
            </p>
            <div className="docflow-confirm-actions">
              <button type="button" className="docflow-btn docflow-btn-edit docflow-confirm-btn-wide" onClick={() => setCancelConfirmDraft(null)}>
                Keep reminder
              </button>
              <button
                type="button"
                className="docflow-btn docflow-btn-cancel docflow-confirm-btn-wide"
                disabled={busy.length > 0 || !draftAction(cancelConfirmDraft, 'cancel_draft_message').ok}
                title={draftAction(cancelConfirmDraft, 'cancel_draft_message').reason ?? undefined}
                onClick={() =>
                  void runDraftCommand('cancel_draft_message', cancelConfirmDraft).then(() => {
                    setCancelConfirmDraft(null);
                  })
                }
              >
                Cancel reminder
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

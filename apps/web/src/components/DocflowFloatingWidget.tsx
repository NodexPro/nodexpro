import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
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
  const auth = useAuth();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailEditing, setDetailEditing] = useState(false);
  const [editBody, setEditBody] = useState('');

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
    if (!panelOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setPanelOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  async function runDraftCommand(command: string, d: PendingDraft, extra?: UnknownRecord): Promise<void> {
    const ctx = isRecord(d.command_context) ? d.command_context : {};
    await runCommand(command, { ...ctx, ...(extra ?? {}) });
  }

  function closePanel(): void {
    setPanelOpen(false);
  }

  function togglePanel(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    setPanelOpen((v) => !v);
  }

  if (!orgId || visibility !== 'visible') {
    return null;
  }

  const detailClientName = String(
    selectedDraft?.client_name ?? selectedDraft?.client_display_name ?? ''
  ).trim();
  const detailRuleName = String(selectedDraft?.rule_name ?? selectedDraft?.rule_value_key ?? '').trim();
  const detailDue =
    String(selectedDraft?.generated_at_display ?? '').trim() ||
    String(selectedDraft?.created_at ?? '').trim();

  return (
    <>
      {panelOpen ? (
        <button
          type="button"
          className="docflow-task-backdrop"
          aria-label="Close DocFlow panel"
          onMouseDown={(e) => {
            e.preventDefault();
            closePanel();
          }}
        />
      ) : null}

      <div className="nx-docflow-widget-root">
        {panelOpen ? (
          <div className="docflow-task-panel" role="dialog" aria-modal="true" aria-labelledby="docflow-task-heading">
            <div className="docflow-task-header">
              <div>
                <div id="docflow-task-heading" className="docflow-task-title">
                  DocFlow Tasks
                </div>
                <div className="docflow-task-subtitle">
                  {pendingCount} pending draft{pendingCount === 1 ? '' : 's'}
                </div>
                <Link
                  to="/m/docflow/messenger"
                  className="docflow-task-messenger-link"
                  onClick={() => closePanel()}
                >
                  Open DocFlow Messenger
                </Link>
                {trialBadge ? (
                  <div className="docflow-task-trial">
                    {trialBadge}
                    {trialDetail ? <div className="docflow-task-trial-detail">{trialDetail}</div> : null}
                  </div>
                ) : null}
              </div>
              <button type="button" className="docflow-task-close" onClick={closePanel} aria-label="Close">
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
                  onClick={() => closePanel()}
                >
                  Open DocFlow Messenger
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
                        {r.length > 22 ? `${r.slice(0, 21)}…` : r}
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
                  <div className="docflow-task-table">
                    <div className="docflow-task-table-header">
                      <span>Client</span>
                      <span>Rule</span>
                      <span>Reason</span>
                      <span>Status</span>
                      <span>Due</span>
                      <span className="docflow-task-table-header-action">Action</span>
                    </div>
                    {filteredDrafts.map((d, idx) => {
                      const id = String(d.draft_id ?? '').trim();
                      const client = String(d.client_name ?? d.client_display_name ?? '').trim() || '—';
                      const rule = String(d.rule_name ?? d.rule_value_key ?? '').trim() || '—';
                      const reason = reasonCellText(d) || '—';
                      const statusLabel = String(d.status_label ?? '').trim() || String(d.status ?? '').trim() || '—';
                      const due =
                        String(d.generated_at_display ?? '').trim() ||
                        String(d.created_at ?? '').trim().replace('T', ' ').slice(0, 16) ||
                        '—';
                      const selected = id && selectedDraftId === id;
                      const showReview = hasAnyReviewAction(d);
                      return (
                        <div
                          key={draftRowKey(d, idx)}
                          className={`docflow-task-row${selected ? ' docflow-task-row-selected' : ''}`}
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
                          <span className="docflow-task-cell-truncate" title={client}>
                            {client}
                          </span>
                          <span className="docflow-task-cell-truncate" title={rule}>
                            {rule}
                          </span>
                          <span className="docflow-task-cell-truncate docflow-task-cell-reason" title={reason}>
                            {reason}
                          </span>
                          <span className="docflow-task-cell-truncate docflow-task-cell-status" title={statusLabel}>
                            <span className="docflow-status-pill">{statusLabel}</span>
                          </span>
                          <span className="docflow-task-cell-truncate docflow-task-cell-due" title={due}>
                            {due}
                          </span>
                          <span className="docflow-task-col-action" onClick={(e) => e.stopPropagation()}>
                            {showReview ? (
                              <button
                                type="button"
                                className="docflow-review-btn"
                                disabled={busy.length > 0}
                                onClick={() => setSelectedDraftId(id || null)}
                              >
                                Review
                              </button>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedDraft && widgetAccess !== 'locked' ? (
                  <div className="docflow-detail-card">
                    <div className="docflow-detail-title">{detailClientName || 'Client'}</div>
                    <div className="docflow-detail-meta">
                      {selectedDraft.client_id ? (
                        <div>
                          <strong>Client ID</strong> {String(selectedDraft.client_id)}
                        </div>
                      ) : null}
                      {detailRuleName ? (
                        <div>
                          <strong>Rule</strong> {detailRuleName}
                        </div>
                      ) : null}
                      {detailDue ? (
                        <div>
                          <strong>Generated</strong> {detailDue}
                        </div>
                      ) : null}
                    </div>

                    {detailEditing && hasDraftAction(selectedDraft, 'edit_draft_message') ? (
                      <textarea
                        className="docflow-edit-textarea"
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        disabled={busy.length > 0}
                        aria-label="Edit message body"
                      />
                    ) : (
                      <div className="docflow-message-preview">
                        {String(selectedDraft.message_body ?? '').trim() ||
                          String(selectedDraft.message_preview ?? selectedDraft.preview_text ?? '').trim() ||
                          '—'}
                      </div>
                    )}

                    <div className="docflow-action-bar">
                      {hasDraftAction(selectedDraft, 'edit_draft_message') && !detailEditing ? (
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
                          onClick={() => void runDraftCommand('cancel_draft_message', selectedDraft)}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>

                    {detailEditing && hasDraftAction(selectedDraft, 'edit_draft_message') ? (
                      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                        <button
                          type="button"
                          className="docflow-btn docflow-btn-edit"
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
                          className="docflow-btn docflow-btn-approve"
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
                    ) : null}
                  </div>
                ) : null}
              </>
            )}

            {loadError ? <div className="docflow-task-error">{loadError}</div> : null}
            {actionError ? <div className="docflow-task-error">{actionError}</div> : null}
          </div>
        ) : null}

        <button
          type="button"
          className="nx-docflow-widget-fab"
          aria-label="DocFlow tasks"
          aria-expanded={panelOpen}
          onClick={togglePanel}
        >
          <div className={`docflow-badge ${badgeModifierClass}`}>
            <div className="docflow-text-top">• DocFlow • DocFlow •</div>
            <img src="/docflow-logo.png" className="docflow-logo" alt="" />
            <div className="docflow-text-bottom">• DocFlow •</div>
          </div>
          {pendingCount > 0 ? <span className="nx-docflow-widget-count">{pendingCount > 99 ? '99+' : pendingCount}</span> : null}
        </button>
      </div>
    </>
  );
}

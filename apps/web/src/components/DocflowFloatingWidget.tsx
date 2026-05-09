import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../api/client';
import { docflowFloatingWidgetAggregate, docflowOfficeCommands } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import './DocflowFloatingWidget.css';

type UnknownRecord = Record<string, unknown>;

type AllowedAction = { command?: string; enabled?: boolean; reason?: string | null };

type PendingDraft = {
  // Stage 4A explicit widget contract
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

  // Backward-compatible fields (keep)
  client_display_name?: string | null;
  preview_text?: string;
  generated_at_display?: string;
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

export function DocflowFloatingWidget() {
  const navigate = useNavigate();
  const auth = useAuth();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
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

  const visibility = String(aggregate?.widget_visibility ?? '');
  if (!orgId || visibility !== 'visible') {
    return null;
  }

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

  const editingDraft = useMemo(() => {
    if (!editingDraftId) return null;
    return drafts.find((d) => String(d.draft_id ?? '') === editingDraftId) ?? null;
  }, [drafts, editingDraftId]);

  useEffect(() => {
    if (!editingDraft) {
      setEditBody('');
      return;
    }
    // Strict NodexPro: editable text must come from backend truth (full body), never from preview.
    setEditBody(String(editingDraft.message_body ?? '').trim());
  }, [editingDraft]);

  async function runCommand(command: string, ctx: UnknownRecord): Promise<void> {
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
  }

  async function runDraftCommand(command: string, d: PendingDraft, extra?: UnknownRecord): Promise<void> {
    const ctx = isRecord(d.command_context) ? d.command_context : {};
    await runCommand(command, { ...ctx, ...(extra ?? {}) });
  }

  return (
    <div
      className="nx-docflow-widget-root"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open ? (
        <div className="nx-docflow-widget-panel" role="dialog" aria-label="DocFlow">
          <div className="nx-docflow-widget-panel-header">
            <h2>DocFlow</h2>
            {trialBadge ? (
              <div className="nx-docflow-widget-trial">
                {trialBadge}
                {trialDetail ? <div className="nx-docflow-widget-trial-detail">{trialDetail}</div> : null}
              </div>
            ) : null}
          </div>
          {widgetAccess === 'locked' ? (
            <div className="nx-docflow-widget-locked">
              {lockedMessage ? <p className="nx-docflow-widget-locked-msg">{lockedMessage}</p> : null}
              <Link
                className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                to={billingPath}
                style={{ display: 'inline-block', textDecoration: 'none' }}
              >
                {billingCta}
              </Link>
            </div>
          ) : null}
          {drafts.length === 0 ? (
            <div className="nx-docflow-widget-empty">No pending drafts</div>
          ) : (
            <div className="nx-docflow-widget-list">
              {drafts.map((d, idx) => {
                const title = String(d.client_name ?? d.client_display_name ?? '').trim() || 'Client';
                const ruleName = String(d.rule_name ?? d.rule_value_key ?? '').trim();
                const meta = [String(d.status_label ?? '').trim(), String(d.generated_at_display ?? '').trim()]
                  .filter(Boolean)
                  .join(' · ');
                const preview = String(d.message_preview ?? d.preview_text ?? '').trim();
                const draftId = String(d.draft_id ?? '').trim();
                return (
                  <div
                    className="nx-docflow-widget-row"
                    key={`${draftId || String(isRecord(d.command_context) ? d.command_context.draft_id : '')}-${String(isRecord(d.command_context) ? d.command_context.rule_run_id : '')}-${idx}`}
                  >
                    <div className="nx-docflow-widget-row-title">{title}</div>
                    <div className="nx-docflow-widget-row-meta">{[ruleName, meta].filter(Boolean).join(' · ')}</div>
                    {preview ? <div className="nx-docflow-widget-row-preview">{preview}</div> : null}
                    <div className="nx-docflow-widget-row-actions">
                      {hasDraftAction(d, 'edit_draft_message') ? (
                        <button
                          type="button"
                          className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                          disabled={busy.length > 0 || !draftAction(d, 'edit_draft_message').ok}
                          title={draftAction(d, 'edit_draft_message').reason ?? undefined}
                          onClick={() => setEditingDraftId(draftId || null)}
                        >
                          Edit
                        </button>
                      ) : null}
                      {hasDraftAction(d, 'approve_draft_message') ? (
                        <button
                          type="button"
                          className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                          disabled={busy.length > 0 || !draftAction(d, 'approve_draft_message').ok}
                          title={draftAction(d, 'approve_draft_message').reason ?? undefined}
                          onClick={() => void runDraftCommand('approve_draft_message', d)}
                        >
                          Approve
                        </button>
                      ) : null}
                      {hasDraftAction(d, 'send_approved_message') ? (
                        <button
                          type="button"
                          className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                          disabled={busy.length > 0 || !draftAction(d, 'send_approved_message').ok}
                          title={draftAction(d, 'send_approved_message').reason ?? undefined}
                          onClick={() => void runDraftCommand('send_approved_message', d)}
                        >
                          Send
                        </button>
                      ) : null}
                      {hasDraftAction(d, 'cancel_draft_message') ? (
                        <button
                          type="button"
                          className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                          disabled={busy.length > 0 || !draftAction(d, 'cancel_draft_message').ok}
                          title={draftAction(d, 'cancel_draft_message').reason ?? undefined}
                          onClick={() => void runDraftCommand('cancel_draft_message', d)}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {editingDraftId && editingDraft ? (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E5E7EB' }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
                Edit draft — {String(editingDraft.client_name ?? editingDraft.client_display_name ?? 'Client')}
              </div>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  borderRadius: 10,
                  border: '1px solid #CBD5E1',
                  padding: 10,
                  fontSize: 13.5,
                  resize: 'vertical',
                }}
                disabled={busy.length > 0}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  disabled={busy.length > 0}
                  onClick={() => {
                    setEditingDraftId(null);
                    setEditBody('');
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                  disabled={
                    busy.length > 0 ||
                    !hasDraftAction(editingDraft, 'edit_draft_message') ||
                    !draftAction(editingDraft, 'edit_draft_message').ok ||
                    !editBody.trim()
                  }
                  title={draftAction(editingDraft, 'edit_draft_message').reason ?? undefined}
                  onClick={() =>
                    void runDraftCommand('edit_draft_message', editingDraft, { message_body: editBody.trim() }).then(() => {
                      setEditingDraftId(null);
                      setEditBody('');
                    })
                  }
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
          {loadError ? <div className="nx-docflow-widget-error">{loadError}</div> : null}
          {actionError ? <div className="nx-docflow-widget-error">{actionError}</div> : null}
        </div>
      ) : null}
      <button
        type="button"
        className="nx-docflow-widget-fab"
        aria-label="DocFlow"
        onClick={() => {
          // Messenger is the primary DocFlow workspace; avoid local truth and rely on aggregates.
          navigate('/m/docflow/messenger');
        }}
      >
        <div className={`docflow-badge ${badgeModifierClass}`}>
          <div className="docflow-text-top">• DocFlow • DocFlow •</div>
          <img src="/docflow-logo.png" className="docflow-logo" alt="" />
          <div className="docflow-text-bottom">• DocFlow •</div>
        </div>
        {pendingCount > 0 ? <span className="nx-docflow-widget-count">{pendingCount > 99 ? '99+' : pendingCount}</span> : null}
      </button>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../api/client';
import { docflowFloatingWidgetAggregate, docflowOfficeCommands } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import './DocflowFloatingWidget.css';

type UnknownRecord = Record<string, unknown>;

type AllowedAction = { command?: string; enabled?: boolean; reason?: string | null };

type PendingDraft = {
  client_display_name?: string | null;
  preview_text?: string;
  status_label?: string;
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

export function DocflowFloatingWidget() {
  const navigate = useNavigate();
  const auth = useAuth();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) {
      setAggregate(null);
      return;
    }
    setLoadError('');
    try {
      const data = (await apiJson(docflowFloatingWidgetAggregate, {
        debugLabel: 'DocflowFloatingWidget.load(floating-widget)',
      })) as UnknownRecord;
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
                const ctx = isRecord(d.command_context) ? d.command_context : {};
                const title = d.client_display_name?.trim() || 'Client';
                return (
                  <div
                    className="nx-docflow-widget-row"
                    key={`${String(isRecord(d.command_context) ? d.command_context.draft_id : '')}-${String(isRecord(d.command_context) ? d.command_context.rule_run_id : '')}-${idx}`}
                  >
                    <div className="nx-docflow-widget-row-title">{title}</div>
                    <div className="nx-docflow-widget-row-meta">{[d.status_label, d.generated_at_display].filter(Boolean).join(' · ')}</div>
                    {d.preview_text ? <div className="nx-docflow-widget-row-preview">{d.preview_text}</div> : null}
                    <div className="nx-docflow-widget-row-actions">
                      <button
                        type="button"
                        className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                        disabled={busy.length > 0 || !draftAction(d, 'approve_draft_message').ok}
                        title={draftAction(d, 'approve_draft_message').reason ?? undefined}
                        onClick={() => void runCommand('approve_draft_message', ctx)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                        disabled={busy.length > 0 || !draftAction(d, 'send_approved_message').ok}
                        title={draftAction(d, 'send_approved_message').reason ?? undefined}
                        onClick={() => void runCommand('send_approved_message', ctx)}
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                        disabled={busy.length > 0 || !draftAction(d, 'cancel_draft_message').ok}
                        title={draftAction(d, 'cancel_draft_message').reason ?? undefined}
                        onClick={() => void runCommand('cancel_draft_message', ctx)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

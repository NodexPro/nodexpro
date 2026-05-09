import { supabaseAdmin } from '../../db/client.js';
import { resolveEntitlement } from '../modules/entitlement.service.js';
import { getTrialState } from '../trial/trial.service.js';
import type { AllowedAction } from './docflow.types.js';

const DOCFLOW_CODE = 'docflow';

function truncatePreview(body: string, maxLen: number): string {
  const t = body.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function formatGeneratedAtDisplay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function statusLabel(status: string): string {
  if (status === 'draft') return 'Draft';
  if (status === 'approved') return 'Awaiting send';
  return status;
}

function buildWidgetDraftAllowedActions(
  status: string,
  actionsDisabled: boolean,
  disableReason: string
): AllowedAction[] {
  const base: { command: string; enabled: boolean; reason: string | null }[] = [
    {
      command: 'edit_draft_message',
      enabled: status === 'draft',
      reason: status === 'draft' ? null : 'Only draft can be edited',
    },
    {
      command: 'approve_draft_message',
      enabled: status === 'draft',
      reason: status === 'draft' ? null : 'Only draft can be approved',
    },
    {
      command: 'cancel_draft_message',
      enabled: status === 'draft' || status === 'approved',
      reason: status === 'draft' || status === 'approved' ? null : 'Already finalized',
    },
    {
      command: 'send_approved_message',
      enabled: status === 'approved',
      reason: status === 'approved' ? null : 'Approve before send',
    },
  ];
  if (actionsDisabled) {
    return base.map((a) => ({
      command: a.command,
      enabled: false,
      reason: disableReason,
    }));
  }
  return base.map((a) => ({
    command: a.command,
    enabled: a.enabled,
    reason: a.enabled ? null : a.reason,
  }));
}

export type DocflowFloatingWidgetBuildOpts = {
  /** When false and org has full DocFlow access, draft actions are disabled (membership cannot run communication commands). */
  can_use_communication_commands?: boolean;
};

export async function buildDocflowFloatingWidgetAggregate(
  orgId: string,
  opts?: DocflowFloatingWidgetBuildOpts
): Promise<Record<string, unknown>> {
  const canUseCommunicationCommands = opts?.can_use_communication_commands !== false;
  const { data: mod, error: modErr } = await supabaseAdmin.from('modules').select('id').eq('code', DOCFLOW_CODE).maybeSingle();
  if (modErr) throw modErr;
  if (!mod?.id) {
    return {
      aggregate_key: 'docflow_floating_widget_aggregate',
      org_id: orgId,
      widget_visibility: 'hidden',
      widget_access: 'hidden',
      badge_ring: 'none',
      trial_badge_label: null,
      trial_detail_line: null,
      locked_message: null,
      locked_title: null,
      billing_cta_label: null,
      billing_path: null,
      pending_draft_count: 0,
      pending_drafts: [],
    };
  }

  const moduleId = mod.id as string;

  const { data: om, error: omErr } = await supabaseAdmin
    .from('organization_modules')
    .select('id')
    .eq('organization_id', orgId)
    .eq('module_id', moduleId)
    .eq('status', 'active')
    .maybeSingle();
  if (omErr) throw omErr;

  if (!om) {
    return {
      aggregate_key: 'docflow_floating_widget_aggregate',
      org_id: orgId,
      widget_visibility: 'hidden',
      widget_access: 'hidden',
      badge_ring: 'none',
      trial_badge_label: null,
      trial_detail_line: null,
      locked_message: null,
      locked_title: null,
      billing_cta_label: null,
      billing_path: null,
      pending_draft_count: 0,
      pending_drafts: [],
    };
  }

  const entitlement = await resolveEntitlement(orgId, moduleId);
  const { data: subRow } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('status, trial_ends_at, ends_at')
    .eq('organization_id', orgId)
    .eq('module_id', moduleId)
    .maybeSingle();

  const accessFull = entitlement.status === 'entitled' || entitlement.status === 'trial';
  const widgetAccess = accessFull ? 'full' : 'locked';
  const subscriptionLocked = !accessFull;
  const permissionLocked = accessFull && !canUseCommunicationCommands;
  const actionsDisabled = subscriptionLocked || permissionLocked;
  const lockReason = 'Subscribe to unlock DocFlow actions';
  const actionDisableReason = subscriptionLocked
    ? lockReason
    : permissionLocked
      ? 'Insufficient permission for DocFlow actions'
      : '';

  let trialBadgeLabel: string | null = null;
  let trialDetailLine: string | null = null;
  if (entitlement.status === 'trial') {
    trialBadgeLabel = 'Trial active';
    const now = Date.now();
    if (subRow?.status === 'trialing' && subRow.trial_ends_at) {
      const end = new Date(subRow.trial_ends_at as string);
      if (Number.isFinite(end.getTime())) {
        const days = Math.max(0, Math.ceil((end.getTime() - now) / (24 * 60 * 60 * 1000)));
        const ymd = end.toISOString().slice(0, 10);
        trialDetailLine = `${days} days until ${ymd}`;
      }
    } else {
      const ts = await getTrialState(orgId);
      if (ts.trialStatus === 'trialing' && ts.daysRemaining != null && ts.endsAt) {
        const ymd = String(ts.endsAt).slice(0, 10);
        trialDetailLine = `${ts.daysRemaining} days until ${ymd}`;
      }
    }
  }

  const badgeRing =
    widgetAccess === 'locked' ? 'locked' : entitlement.status === 'trial' ? 'trial_active' : 'active_paid';

  const lockedTitle = subscriptionLocked ? 'DocFlow locked' : null;
  const lockedMessage = subscriptionLocked ? 'Module locked. Please subscribe.' : null;
  const billingCtaLabel = subscriptionLocked ? 'Go to billing' : null;
  const billingPath = subscriptionLocked ? '/billing' : null;

  const { data: draftRows, error: dErr } = await supabaseAdmin
    .from('communication_draft_messages')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['draft', 'approved'])
    .order('generated_at', { ascending: false })
    .limit(50);
  if (dErr) throw dErr;

  const drafts = draftRows ?? [];
  const clientIds = [...new Set(drafts.map((d) => d.client_id as string))];
  const displayByClient = new Map<string, string | null>();
  if (clientIds.length) {
    const { data: cRows, error: cErr } = await supabaseAdmin.from('clients').select('id, display_name').in('id', clientIds);
    if (cErr) throw cErr;
    for (const c of cRows ?? []) displayByClient.set(c.id as string, (c.display_name as string) ?? null);
  }

  const runIds = [...new Set(drafts.map((d) => d.rule_run_id as string))];
  const ruleKeyByRun = new Map<string, string | null>();
  const legalValueIdByRun = new Map<string, string | null>();
  if (runIds.length) {
    const { data: runs, error: rErr } = await supabaseAdmin
      .from('communication_rule_runs')
      .select('id, source_value_key, source_legal_value_id')
      .eq('org_id', orgId)
      .in('id', runIds);
    if (rErr) throw rErr;
    for (const r of runs ?? []) {
      ruleKeyByRun.set(r.id as string, (r.source_value_key as string) ?? null);
      legalValueIdByRun.set(r.id as string, (r.source_legal_value_id as string) ?? null);
    }
  }

  const legalValueIds = [...new Set([...legalValueIdByRun.values()].filter((x): x is string => typeof x === 'string' && x.trim() !== ''))];
  const ruleLabelByLegalValueId = new Map<string, string | null>();
  if (legalValueIds.length) {
    const { data: lvRows, error: lvErr } = await supabaseAdmin
      .from('country_legal_values')
      .select('id, label, value_key')
      .in('id', legalValueIds);
    if (lvErr) throw lvErr;
    for (const lv of lvRows ?? []) {
      const id = String(lv.id ?? '').trim();
      if (!id) continue;
      const label = lv.label != null ? String(lv.label).trim() : '';
      const key = lv.value_key != null ? String(lv.value_key).trim() : '';
      ruleLabelByLegalValueId.set(id, label || key || null);
    }
  }

  const pendingDrafts = drafts.map((row) => {
    const r = row as Record<string, unknown>;
    const cid = String(r.client_id ?? '');
    const st = String(r.status ?? '');
    const rid = String(r.rule_run_id ?? '');
    const body = String(r.message_body ?? '');
    const draftId = String(r.id ?? '').trim();
    const createdAt = (r.generated_at ?? null) as string | null;
    const ruleValueKey = ruleKeyByRun.get(rid) ?? null;
    const legalValueId = legalValueIdByRun.get(rid) ?? null;
    const ruleName = (legalValueId ? ruleLabelByLegalValueId.get(legalValueId) : null) ?? ruleValueKey;
    return {
      // Explicit draft fields (Stage 4A widget contract)
      draft_id: draftId,
      client_id: cid,
      client_name: displayByClient.get(cid) ?? null,
      rule_name: ruleName,
      rule_value_key: ruleValueKey,
      message_body: body,
      message_preview: truncatePreview(body, 200),
      status: st,
      status_label: statusLabel(st),
      created_at: createdAt,

      // Backward-compatible / UI convenience fields (keep until all consumers migrated)
      client_display_name: displayByClient.get(cid) ?? null,
      preview_text: truncatePreview(body, 200),
      status_code: st,
      status_label_legacy: statusLabel(st),
      generated_at: r.generated_at ?? null,
      generated_at_display: formatGeneratedAtDisplay(r.generated_at as string | null),
      command_context: {
        rule_run_id: rid,
        draft_id: draftId,
      },
      allowed_actions: buildWidgetDraftAllowedActions(st, actionsDisabled, actionDisableReason || lockReason),
    };
  });

  return {
    aggregate_key: 'docflow_floating_widget_aggregate',
    org_id: orgId,
    widget_visibility: 'visible',
    widget_access: widgetAccess,
    entitlement_status: entitlement.status,
    badge_ring: badgeRing,
    trial_badge_label: trialBadgeLabel,
    trial_detail_line: trialDetailLine,
    locked_title: lockedTitle,
    locked_message: lockedMessage,
    billing_cta_label: billingCtaLabel,
    billing_path: billingPath,
    pending_draft_count: pendingDrafts.length,
    pending_drafts: pendingDrafts,
  };
}

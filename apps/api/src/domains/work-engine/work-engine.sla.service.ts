/**
 * Stage 10 Phase 3A — operational SLA obligations + sla_status recompute.
 * No reminders, escalation, scheduler, or legal deadlines.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import {
  DEFAULT_SLA_POLICY,
  type WorkTypeSlaPolicy,
  resolveWorkTypeSlaPolicy,
} from './work-engine.policy.service.js';
import type { SlaStatus, WorkEngineCommandType, WorkState } from './work-engine.types.js';

export const SLA_OBLIGATION_KINDS = ['response', 'waiting_client', 'review'] as const;
export type SlaObligationKind = (typeof SLA_OBLIGATION_KINDS)[number];

export const SLA_OBLIGATION_STATUSES = ['active', 'met', 'breached', 'cancelled'] as const;
export type SlaObligationStatus = (typeof SLA_OBLIGATION_STATUSES)[number];

export type WorkSlaObligationRow = {
  id: string;
  org_id: string;
  work_item_id: string;
  kind: SlaObligationKind;
  policy_version_id: string | null;
  starts_at: string;
  due_at: string;
  paused_at: string | null;
  pause_reason: string | null;
  status: SlaObligationStatus;
  breached_at: string | null;
  source_transition_id: string | null;
  created_at: string;
  updated_at: string;
};

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function obligationKindLabel(kind: SlaObligationKind): string {
  switch (kind) {
    case 'response':
      return 'Response';
    case 'waiting_client':
      return 'Client wait';
    case 'review':
      return 'Review';
    default:
      return kind;
  }
}

function obligationBadgeTone(
  status: SlaObligationStatus,
  dueAt: string,
  nowMs: number,
  dueSoonThresholdMinutes: number,
): 'neutral' | 'warn' | 'danger' {
  if (status === 'breached') return 'danger';
  if (status !== 'active') return 'neutral';
  const dueMs = new Date(dueAt).getTime();
  if (dueMs < nowMs) return 'danger';
  if (dueMs <= nowMs + dueSoonThresholdMinutes * 60_000) return 'warn';
  return 'neutral';
}

async function auditSla(
  orgId: string,
  actorUserId: string | null,
  workItemId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: orgId,
    actorUserId,
    moduleCode: 'work_engine',
    entityType: 'work_item',
    entityId: workItemId,
    action,
    payload,
  });
}

async function cancelActiveObligation(
  orgId: string,
  workItemId: string,
  kind: SlaObligationKind,
  reason: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('work_sla_obligations')
    .update({
      status: 'cancelled',
      paused_at: null,
      pause_reason: null,
    })
    .eq('org_id', orgId)
    .eq('work_item_id', workItemId)
    .eq('kind', kind)
    .eq('status', 'active');
  if (error) throw error;
  void reason;
}

async function markActiveObligationMet(
  orgId: string,
  workItemId: string,
  kind: SlaObligationKind,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('work_sla_obligations')
    .update({
      status: 'met',
      paused_at: null,
      pause_reason: null,
    })
    .eq('org_id', orgId)
    .eq('work_item_id', workItemId)
    .eq('kind', kind)
    .eq('status', 'active')
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function startObligation(args: {
  orgId: string;
  workItemId: string;
  kind: SlaObligationKind;
  durationMinutes: number;
  sourceTransitionId: string | null;
  actorUserId: string | null;
  policy: WorkTypeSlaPolicy;
}): Promise<void> {
  await cancelActiveObligation(args.orgId, args.workItemId, args.kind, 'superseded');
  const startsAt = new Date().toISOString();
  const dueAt = addMinutes(startsAt, args.durationMinutes);
  const { data, error } = await supabaseAdmin
    .from('work_sla_obligations')
    .insert({
      org_id: args.orgId,
      work_item_id: args.workItemId,
      kind: args.kind,
      policy_version_id: null,
      starts_at: startsAt,
      due_at: dueAt,
      paused_at: null,
      pause_reason: null,
      status: 'active',
      breached_at: null,
      source_transition_id: args.sourceTransitionId,
    })
    .select('id')
    .single();
  if (error) throw error;
  await auditSla(args.orgId, args.actorUserId, args.workItemId, AUDIT_ACTIONS.WORK_ITEM_SLA_OBLIGATION_STARTED, {
    obligation_id: data.id,
    kind: args.kind,
    starts_at: startsAt,
    due_at: dueAt,
    duration_minutes: args.durationMinutes,
    response_sla_minutes: args.policy.response_sla_minutes,
    review_sla_minutes: args.policy.review_sla_minutes,
    waiting_client_timeout_minutes: args.policy.waiting_client_timeout_minutes,
  });
}

export async function loadActiveSlaObligationsForItems(
  orgId: string,
  workItemIds: string[],
): Promise<Map<string, WorkSlaObligationRow[]>> {
  const map = new Map<string, WorkSlaObligationRow[]>();
  if (workItemIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('work_sla_obligations')
    .select('*')
    .eq('org_id', orgId)
    .in('work_item_id', workItemIds)
    .in('status', ['active', 'breached']);
  if (error) throw error;
  for (const row of (data ?? []) as WorkSlaObligationRow[]) {
    const list = map.get(row.work_item_id) ?? [];
    list.push(row);
    map.set(row.work_item_id, list);
  }
  return map;
}

export type QueueSlaPresentation = {
  sla_badges: Array<{ kind: string; label: string; tone: 'neutral' | 'warn' | 'danger' }>;
  primary_due_at_label: string | null;
};

export function buildQueueSlaPresentation(
  obligations: WorkSlaObligationRow[],
  slaStatus: SlaStatus,
  workItemDueAt: string | null,
  policy: WorkTypeSlaPolicy = DEFAULT_SLA_POLICY,
): QueueSlaPresentation {
  const nowMs = Date.now();
  const activeOrBreached = obligations.filter((o) => o.status === 'active' || o.status === 'breached');
  const sla_badges = activeOrBreached.map((o) => ({
    kind: o.kind,
    label: `${obligationKindLabel(o.kind)} · ${formatSlaDueLabel(o.due_at)}`,
    tone: obligationBadgeTone(o.status, o.due_at, nowMs, policy.due_soon_threshold_minutes),
  }));
  const primary =
    activeOrBreached.find((o) => o.kind === 'response') ??
    activeOrBreached.find((o) => o.kind === 'review') ??
    activeOrBreached[0];
  const primaryIso = primary?.due_at ?? workItemDueAt;
  const primary_due_at_label =
    primaryIso && slaStatus !== 'none' ? formatSlaDueLabel(primaryIso) : null;
  return { sla_badges, primary_due_at_label };
}

function formatSlaDueLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

async function markDueActiveObligationsBreached(
  orgId: string,
  workItemId: string,
  actorUserId: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('work_sla_obligations')
    .select('id, kind, due_at, paused_at')
    .eq('org_id', orgId)
    .eq('work_item_id', workItemId)
    .eq('status', 'active')
    .lt('due_at', nowIso);
  if (error) throw error;
  for (const row of data ?? []) {
    if ((row as { paused_at?: string | null }).paused_at) continue;
    const id = String((row as { id: string }).id);
    const kind = String((row as { kind: string }).kind);
    const { error: updErr } = await supabaseAdmin
      .from('work_sla_obligations')
      .update({
        status: 'breached',
        breached_at: nowIso,
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('status', 'active');
    if (updErr) throw updErr;
    await auditSla(orgId, actorUserId, workItemId, AUDIT_ACTIONS.WORK_ITEM_SLA_OBLIGATION_BREACHED, {
      obligation_id: id,
      kind,
      breached_at: nowIso,
    });
  }
}

function computeSlaStatusFromObligations(
  obligations: WorkSlaObligationRow[],
  policy: WorkTypeSlaPolicy,
): SlaStatus {
  const nowMs = Date.now();
  const active = obligations.filter((o) => o.status === 'active' && !o.paused_at);
  const breached = obligations.filter((o) => o.status === 'breached');
  if (active.length === 0 && breached.length === 0) return 'none';
  if (breached.length > 0) return 'breached';
  if (active.some((o) => new Date(o.due_at).getTime() < nowMs)) return 'overdue';
  const thresholdMs = policy.due_soon_threshold_minutes * 60_000;
  if (
    active.some((o) => {
      const dueMs = new Date(o.due_at).getTime();
      return dueMs >= nowMs && dueMs <= nowMs + thresholdMs;
    })
  ) {
    return 'due_soon';
  }
  return 'on_track';
}

export async function recomputeWorkItemSlaStatus(
  orgId: string,
  workItemId: string,
  opts?: { actorUserId?: string | null; auditOnStatusChange?: boolean },
): Promise<SlaStatus> {
  const { data: item, error: itemErr } = await supabaseAdmin
    .from('work_items')
    .select('id, org_id, work_type, sla_status, due_at, version')
    .eq('id', workItemId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (itemErr) throw itemErr;
  if (!item) return 'none';

  const workType = String((item as { work_type: string }).work_type);
  const policy = await resolveWorkTypeSlaPolicy(orgId, workType);
  const previousStatus = String((item as { sla_status: string }).sla_status) as SlaStatus;

  await markDueActiveObligationsBreached(orgId, workItemId, opts?.actorUserId ?? null);

  const { data: rows, error: obErr } = await supabaseAdmin
    .from('work_sla_obligations')
    .select('*')
    .eq('org_id', orgId)
    .eq('work_item_id', workItemId)
    .in('status', ['active', 'breached']);
  if (obErr) throw obErr;
  const obligations = (rows ?? []) as WorkSlaObligationRow[];
  const nextStatus = computeSlaStatusFromObligations(obligations, policy);

  const primaryDue =
    obligations.find((o) => o.status === 'active' && o.kind === 'response')?.due_at ??
    obligations.find((o) => o.status === 'active' && o.kind === 'review')?.due_at ??
    obligations.find((o) => o.status === 'active')?.due_at ??
    null;

  const patch: Record<string, unknown> = { sla_status: nextStatus };
  if (primaryDue != null) patch.due_at = primaryDue;

  const { error: updErr } = await supabaseAdmin
    .from('work_items')
    .update(patch)
    .eq('id', workItemId)
    .eq('org_id', orgId);
  if (updErr) throw updErr;

  if (opts?.auditOnStatusChange && nextStatus !== previousStatus) {
    await auditSla(orgId, opts.actorUserId ?? null, workItemId, AUDIT_ACTIONS.WORK_ITEM_SLA_STATUS_RECOMPUTED, {
      from_sla_status: previousStatus,
      to_sla_status: nextStatus,
    });
  }

  return nextStatus;
}

/** Command-time SLA obligation hooks (Phase 3A). */
export async function applySlaHooksForCommand(args: {
  orgId: string;
  workItemId: string;
  command: WorkEngineCommandType;
  transitionId: string | null;
  actorUserId: string | null;
  toState?: WorkState;
  workType: string;
}): Promise<void> {
  const policy = await resolveWorkTypeSlaPolicy(args.orgId, args.workType);

  switch (args.command) {
    case 'pick_up_unassigned':
    case 'assign_work_item': {
      await startObligation({
        orgId: args.orgId,
        workItemId: args.workItemId,
        kind: 'response',
        durationMinutes: policy.response_sla_minutes,
        sourceTransitionId: args.transitionId,
        actorUserId: args.actorUserId,
        policy,
      });
      break;
    }
    case 'request_review': {
      await cancelActiveObligation(args.orgId, args.workItemId, 'response', 'review_requested');
      await startObligation({
        orgId: args.orgId,
        workItemId: args.workItemId,
        kind: 'review',
        durationMinutes: policy.review_sla_minutes,
        sourceTransitionId: args.transitionId,
        actorUserId: args.actorUserId,
        policy,
      });
      break;
    }
    case 'approve_work_item':
    case 'reject_work_item': {
      const met = await markActiveObligationMet(args.orgId, args.workItemId, 'review');
      if (met) {
        await auditSla(
          args.orgId,
          args.actorUserId,
          args.workItemId,
          AUDIT_ACTIONS.WORK_ITEM_SLA_OBLIGATION_MET,
          { kind: 'review', command: args.command },
        );
      }
      await startObligation({
        orgId: args.orgId,
        workItemId: args.workItemId,
        kind: 'response',
        durationMinutes: policy.response_sla_minutes,
        sourceTransitionId: args.transitionId,
        actorUserId: args.actorUserId,
        policy,
      });
      break;
    }
    case 'change_work_state': {
      if (args.toState === 'waiting_client') {
        await cancelActiveObligation(args.orgId, args.workItemId, 'response', 'waiting_client');
        await startObligation({
          orgId: args.orgId,
          workItemId: args.workItemId,
          kind: 'waiting_client',
          durationMinutes: policy.waiting_client_timeout_minutes,
          sourceTransitionId: args.transitionId,
          actorUserId: args.actorUserId,
          policy,
        });
      }
      break;
    }
    default:
      break;
  }

  await recomputeWorkItemSlaStatus(args.orgId, args.workItemId, {
    actorUserId: args.actorUserId,
    auditOnStatusChange: true,
  });
}

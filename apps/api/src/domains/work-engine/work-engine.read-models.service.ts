/**
 * Work Engine read models (Stage 2 foundation).
 * Source of truth: docs/work-engine-aggregates.md (future doc); for now follow the
 * "ready-to-render" rules from docs/work-engine-state-machine.md §8 and the boundary doc.
 *
 * UI consumes aggregates verbatim. UI never recomputes labels, counts, or allowed_actions.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { AllowedAction, WorkItemRow, WorkState } from './work-engine.types.js';
import { WORK_STATES } from './work-engine.types.js';

function workStateLabel(state: WorkState): string {
  switch (state) {
    case 'new':
      return 'New';
    case 'assigned':
      return 'Assigned';
    case 'waiting_human':
      return 'Waiting (Office)';
    case 'waiting_client':
      return 'Waiting Client';
    case 'client_replied':
      return 'Client Replied';
    case 'review_pending':
      return 'Review Pending';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'overdue':
      return 'Overdue';
    case 'escalated':
      return 'Escalated';
    case 'done':
      return 'Done';
    case 'archived':
      return 'Archived';
    default:
      return state;
  }
}

function slaStatusLabel(s: string): string {
  switch (s) {
    case 'none':
      return 'No SLA';
    case 'on_track':
      return 'On track';
    case 'due_soon':
      return 'Due soon';
    case 'overdue':
      return 'Overdue';
    case 'breached':
      return 'Breached';
    default:
      return s;
  }
}

function workItemAllowedActions(state: WorkState): AllowedAction[] {
  const archived = state === 'archived';
  return [
    {
      command: 'assign_work_item',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'change_work_state',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'set_work_deadline',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    {
      command: 'apply_work_override',
      enabled: !archived,
      reason: archived ? 'Work item is archived' : null,
    },
    { command: 'append_work_event', enabled: true, reason: null },
  ];
}

type CountsScanRow = { work_state: string };

export async function buildWorkEngineFoundationAggregate(params: {
  orgId: string;
}): Promise<Record<string, unknown>> {
  const { orgId } = params;

  // Counts: bounded scan; Stage 2 has no rule worker, so cardinality is small.
  const countsResp = await supabaseAdmin
    .from('work_items')
    .select('work_state')
    .eq('org_id', orgId)
    .limit(5000);
  if (countsResp.error) throw countsResp.error;
  const countsRows = (countsResp.data ?? []) as CountsScanRow[];

  const counts: Record<string, number> = {};
  for (const s of WORK_STATES) counts[s] = 0;
  let totalActive = 0;
  for (const r of countsRows) {
    const st = r.work_state as WorkState;
    counts[st] = (counts[st] ?? 0) + 1;
    if (st !== 'done' && st !== 'archived') totalActive += 1;
  }
  const totalLoaded = countsRows.length;

  const recentResp = await supabaseAdmin
    .from('work_items')
    .select(
      'id, client_id, module_key, work_type, period_key, work_state, owner_user_id, assigned_user_id, reviewer_user_id, escalation_owner_id, due_at, sla_status, override_active, version, created_at, updated_at',
    )
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(25);
  if (recentResp.error) throw recentResp.error;
  const recentItems = (recentResp.data ?? []) as Array<
    Pick<
      WorkItemRow,
      | 'id'
      | 'client_id'
      | 'module_key'
      | 'work_type'
      | 'period_key'
      | 'work_state'
      | 'owner_user_id'
      | 'assigned_user_id'
      | 'reviewer_user_id'
      | 'escalation_owner_id'
      | 'due_at'
      | 'sla_status'
      | 'override_active'
      | 'version'
      | 'created_at'
      | 'updated_at'
    >
  >;

  return {
    aggregate_key: 'work_engine_foundation_aggregate',
    org_id: orgId,
    generated_at: new Date().toISOString(),
    counts: {
      by_state: counts,
      total_active: totalActive,
      total_loaded: totalLoaded,
    },
    recent_items: recentItems.map((r) => ({
      id: r.id,
      client_id: r.client_id,
      module_key: r.module_key,
      work_type: r.work_type,
      period_key: r.period_key,
      work_state: r.work_state,
      work_state_label: workStateLabel(r.work_state),
      sla_status: r.sla_status,
      sla_status_label: slaStatusLabel(r.sla_status),
      due_at: r.due_at,
      owner_user_id: r.owner_user_id,
      assigned_user_id: r.assigned_user_id,
      reviewer_user_id: r.reviewer_user_id,
      escalation_owner_id: r.escalation_owner_id,
      override_active: r.override_active,
      version: r.version,
      created_at: r.created_at,
      updated_at: r.updated_at,
      allowed_actions: workItemAllowedActions(r.work_state),
    })),
    backend_owned_state_catalog: WORK_STATES.map((s) => ({
      value: s,
      label: workStateLabel(s),
      terminal: s === 'done' || s === 'archived',
    })),
  };
}

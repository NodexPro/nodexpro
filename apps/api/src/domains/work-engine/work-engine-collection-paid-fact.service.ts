/**
 * INV-4E — consume income.invoice_paid → auto-close invoice_collection_followup.
 * Partial payments do not close. Reopen is via re-emitted income.invoice_overdue.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import {
  INCOME_WORK_EVENT_INVOICE_PAID,
  INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
  shouldAutoCloseCollectionFollowup,
} from './work-engine-collection-reminder.pure.js';
import type { WorkItemRow } from './work-engine.types.js';

export type IncomeInvoicePaidFactConsumption = {
  completedWorkItemId: string | null;
  cancelledCandidateCount: number;
  processingOutcome: string;
  closed: boolean;
};

async function findActiveCollectionWorkItem(params: {
  orgId: string;
  clientId: string;
  incomeDocumentId: string;
}): Promise<WorkItemRow | null> {
  const { data, error } = await supabaseAdmin
    .from('work_items')
    .select('*')
    .eq('org_id', params.orgId)
    .eq('client_id', params.clientId)
    .eq('module_key', 'income')
    .eq('work_type', INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE)
    .eq('source_entity_id', params.incomeDocumentId)
    .not('work_state', 'in', '(done,archived)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkItemRow | null) ?? null;
}

async function completeCollectionFollowupWorkItem(params: {
  orgId: string;
  workItem: WorkItemRow;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
}): Promise<WorkItemRow> {
  const current = params.workItem;
  if (current.work_state === 'done' || current.work_state === 'archived') {
    return current;
  }

  const newVersion = current.version + 1;
  const { data, error } = await supabaseAdmin
    .from('work_items')
    .update({ work_state: 'done', version: newVersion })
    .eq('org_id', params.orgId)
    .eq('id', current.id)
    .eq('version', current.version)
    .select('*')
    .single();
  if (error) throw error;

  const updated = data as WorkItemRow;
  const { error: transitionErr } = await supabaseAdmin.from('work_transitions').insert({
    org_id: params.orgId,
    work_item_id: current.id,
    from_state: current.work_state,
    to_state: 'done',
    transition_kind: 'automation',
    action_code: 'collection_followup_auto_closed_paid',
    actor_type: params.actorUserId ? 'user' : 'system',
    actor_user_id: params.actorUserId,
    reason_text: null,
    metadata_json: params.metadata,
    expected_version: current.version,
    resulting_version: newVersion,
  });
  if (transitionErr) throw transitionErr;

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'work_engine',
    entityType: 'work_item',
    entityId: current.id,
    action: AUDIT_ACTIONS.WORK_ITEM_STATE_CHANGED,
    payload: {
      from_state: current.work_state,
      to_state: 'done',
      reason_code: 'collection_followup_auto_closed_paid',
      ...params.metadata,
    },
  });

  return updated;
}

async function cancelOpenCollectionReminderCandidates(params: {
  orgId: string;
  workItemId: string;
  actorUserId: string | null;
}): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('work_reminder_candidates')
    .update({
      status: 'cancelled',
      cancelled_by_user_id: params.actorUserId,
      cancelled_at: nowIso,
    })
    .eq('org_id', params.orgId)
    .eq('work_item_id', params.workItemId)
    .in('status', [
      'pending_review',
      'edited',
      'approved',
      'sending',
      'snoozed',
      'delivery_failed',
    ])
    .select('id');
  if (error) throw error;
  const ids = (data ?? []).map((r) => String((r as { id: string }).id));
  for (const id of ids) {
    await writeAudit({
      organizationId: params.orgId,
      actorUserId: params.actorUserId,
      moduleCode: 'work_engine',
      entityType: 'work_reminder_candidate',
      entityId: id,
      action: AUDIT_ACTIONS.REMINDER_CANDIDATE_CANCELLED,
      payload: {
        work_item_id: params.workItemId,
        reason: 'invoice_paid_auto_close',
      },
    });
  }
  return ids.length;
}

/**
 * Consume paid/partial facts. Only fully paid closes collection.
 * Partial → recorded outcome, work item stays open.
 */
export async function consumeIncomeInvoicePaidFact(params: {
  orgId: string;
  clientId: string;
  incomeDocumentId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
  actorUserId: string | null;
}): Promise<IncomeInvoicePaidFactConsumption> {
  const remaining = Number(params.payload.remaining_balance_reference ?? NaN);
  const paymentStateKey =
    params.eventType === INCOME_WORK_EVENT_INVOICE_PAID
      ? 'paid'
      : Number.isFinite(remaining) && remaining <= 0
        ? 'paid'
        : 'partial';

  if (
    !shouldAutoCloseCollectionFollowup({
      paymentStateKey,
      remainingBalance: Number.isFinite(remaining) ? remaining : paymentStateKey === 'paid' ? 0 : 1,
    })
  ) {
    return {
      completedWorkItemId: null,
      cancelledCandidateCount: 0,
      processingOutcome: 'income_invoice_partial_fact_acknowledged',
      closed: false,
    };
  }

  const workItem = await findActiveCollectionWorkItem({
    orgId: params.orgId,
    clientId: params.clientId,
    incomeDocumentId: params.incomeDocumentId,
  });
  if (!workItem) {
    return {
      completedWorkItemId: null,
      cancelledCandidateCount: 0,
      processingOutcome: 'income_invoice_paid_fact_no_active_collection',
      closed: false,
    };
  }

  const completed = await completeCollectionFollowupWorkItem({
    orgId: params.orgId,
    workItem,
    actorUserId: params.actorUserId,
    metadata: {
      event_id: params.eventId,
      event_type: params.eventType,
      income_document_id: params.incomeDocumentId,
      remaining_balance_reference: params.payload.remaining_balance_reference ?? 0,
      payment_id: params.payload.payment_id ?? null,
    },
  });

  const cancelledCandidateCount = await cancelOpenCollectionReminderCandidates({
    orgId: params.orgId,
    workItemId: completed.id,
    actorUserId: params.actorUserId,
  });

  return {
    completedWorkItemId: completed.id,
    cancelledCandidateCount,
    processingOutcome: 'income_invoice_paid_fact_consumed',
    closed: true,
  };
}

/**
 * INV-4C — collection_reminder_review_aggregate.
 * One candidate review case with current AB debt truth + backend allowed_actions.
 * Approve ≠ send (delivery is INV-4D).
 */

import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { hasPermission } from '../rbac/rbac.service.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { resolveIncomeInvoiceOriginalAmount } from '../accounting-base/accounting-base-income-payment.pure.js';
import {
  backendTodayIsoDate,
  resolveIncomeOverdueCollectionIntake,
} from '../income/invoice-lifecycle.pure.js';
import { isUuid } from './work-engine.guards.js';
import { WORK_ENGINE_PERMISSIONS } from './work-engine.rbac.js';
import { listAttempts } from '../delivery/index.js';
import {
  COLLECTION_REMINDER_APPROVE_COMMAND,
  COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
  COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
  COLLECTION_REMINDER_REVIEW_AGGREGATE_KEY,
  COLLECTION_REMINDER_SEND_COMMAND,
  composeCollectionReminderInvoiceTruth,
  INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
  isCollectionReminderMutatableStatus,
  resolveCollectionReminderApproveGate,
  resolveCollectionReminderSendGate,
  type CollectionReminderApproveBlockReasonKey,
  type CollectionReminderSendBlockReasonKey,
} from './work-engine-collection-reminder.pure.js';
import {
  loadReminderCandidate,
  REMINDER_SNOOZE_PRESETS,
  type ReminderCandidateRow,
  type ReminderReviewViewerContext,
} from './work-engine.reminder-review.service.js';

export type CollectionReminderReviewAllowedAction = {
  action_key: string;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
  reason_key:
    | CollectionReminderApproveBlockReasonKey
    | CollectionReminderSendBlockReasonKey
    | string
    | null;
  command: string;
  command_payload: Record<string, unknown>;
};

export type CollectionReminderReviewAggregate = {
  aggregate_key: typeof COLLECTION_REMINDER_REVIEW_AGGREGATE_KEY;
  ui: {
    title: string;
    subtitle: string;
    approve_means_ready_for_delivery: true;
    approve_does_not_send: true;
  };
  candidate: {
    id: string;
    status: string;
    workflow_type: string;
    step_key: string;
    created_at: string;
    due_at: string | null;
    version: number;
    snoozed_until: string | null;
  };
  work_item: {
    id: string;
    work_type: string;
    work_state: string;
    period_key: string | null;
  };
  invoice: {
    income_document_id: string;
    document_number: string;
    document_type: string;
    issue_date: string | null;
    due_date: string | null;
    days_overdue: number | null;
  };
  financial: {
    currency: string;
    original_amount: number;
    paid_amount: number;
    remaining_balance: number;
    payment_state_key: string;
    financial_source: 'accounting_base';
  };
  client: {
    represented_client_id: string | null;
    display_name: string | null;
  };
  message: {
    subject: string | null;
    body: string;
    language: string | null;
    editable_fields: Array<'subject' | 'body'>;
  };
  delivery: {
    available_channels: string[];
    primary_channel: string | null;
    target_type: string;
    recipient: {
      client_id: string | null;
      target_user_id: string | null;
    };
    history: {
      attempt_count: number;
      last_attempt_at: string | null;
      last_result: string | null;
      last_channel: string | null;
      attempts: Array<{
        id: string;
        channel: string;
        result: string;
        created_at: string;
        sent_at: string | null;
        failure_reason: string | null;
      }>;
    };
  };
  collection_eligibility: {
    still_open_overdue: boolean;
    approve_block_reason_key: CollectionReminderApproveBlockReasonKey | null;
    send_block_reason_key: CollectionReminderSendBlockReasonKey | null;
  };
  allowed_actions: CollectionReminderReviewAllowedAction[];
};

function canWrite(viewer: ReminderReviewViewerContext | null | undefined): boolean {
  if (!viewer) return false;
  return (
    hasPermission([...viewer.permissions], WORK_ENGINE_PERMISSIONS.write) ||
    hasPermission([...viewer.permissions], WORK_ENGINE_PERMISSIONS.admin)
  );
}

function parseChannels(snapshot: unknown, primary: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(snapshot)) {
    for (const item of snapshot) {
      const key = String(item ?? '')
        .trim()
        .toLowerCase()
        .split(':')[0];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  if (primary && !seen.has(primary)) out.unshift(primary);
  return out;
}

function buildCollectionAllowedActions(params: {
  candidate: ReminderCandidateRow;
  viewer: ReminderReviewViewerContext | null | undefined;
  approveGate: ReturnType<typeof resolveCollectionReminderApproveGate>;
  sendGate: ReturnType<typeof resolveCollectionReminderSendGate>;
}): CollectionReminderReviewAllowedAction[] {
  const write = canWrite(params.viewer);
  const mutatable = isCollectionReminderMutatableStatus(params.candidate.status);
  const payloadBase = {
    reminder_candidate_id: params.candidate.id,
    expected_version: params.candidate.version,
    idempotency_key: null as string | null,
    refresh_aggregate: COLLECTION_REMINDER_REVIEW_AGGREGATE_KEY,
  };

  const permReason =
    params.viewer == null
      ? 'נדרשת חברות בארגון'
      : 'חסרה הרשאת work_engine.write';

  const editEnabled =
    write &&
    mutatable &&
    params.candidate.status !== 'approved' &&
    params.candidate.status !== 'sent' &&
    params.candidate.status !== 'sending';
  const cancelEnabled =
    write &&
    mutatable &&
    params.candidate.status !== 'approved' &&
    params.candidate.status !== 'sent';
  const snoozeEnabled =
    write &&
    (params.candidate.status === 'pending_review' ||
      params.candidate.status === 'edited');

  const approveEnabled =
    write &&
    params.approveGate.allowed &&
    (params.candidate.status === 'pending_review' ||
      params.candidate.status === 'edited' ||
      params.candidate.status === 'delivery_failed');

  const sendEnabled = write && params.sendGate.allowed;

  return [
    {
      action_key: 'edit_reminder_candidate',
      label: 'עריכה',
      enabled: editEnabled,
      disabled_reason: editEnabled
        ? null
        : !write
          ? permReason
          : 'לא ניתן לערוך מועמד במצב הנוכחי',
      reason_key: editEnabled ? null : !write ? 'missing_permission' : 'candidate_not_approvable_status',
      command: 'edit_reminder_candidate',
      command_payload: { ...payloadBase },
    },
    {
      action_key: COLLECTION_REMINDER_APPROVE_COMMAND,
      label: 'אישור',
      enabled: approveEnabled,
      disabled_reason: approveEnabled ? null : params.approveGate.disabled_reason,
      reason_key: approveEnabled ? null : params.approveGate.reason_key,
      command: COLLECTION_REMINDER_APPROVE_COMMAND,
      command_payload: { ...payloadBase },
    },
    {
      action_key: COLLECTION_REMINDER_SEND_COMMAND,
      label: params.candidate.status === 'delivery_failed' ? 'נסה שוב' : 'שליחה',
      enabled: sendEnabled,
      disabled_reason: sendEnabled ? null : params.sendGate.disabled_reason,
      reason_key: sendEnabled ? null : params.sendGate.reason_key,
      command: COLLECTION_REMINDER_SEND_COMMAND,
      command_payload: { ...payloadBase },
    },
    {
      action_key: 'cancel_reminder_candidate',
      label: 'ביטול',
      enabled: cancelEnabled,
      disabled_reason: cancelEnabled
        ? null
        : !write
          ? permReason
          : 'לא ניתן לבטל מועמד במצב הנוכחי',
      reason_key: cancelEnabled ? null : !write ? 'missing_permission' : 'candidate_terminal',
      command: 'cancel_reminder_candidate',
      command_payload: { ...payloadBase },
    },
    {
      action_key: 'snooze_reminder_candidate',
      label: 'דחייה',
      enabled: snoozeEnabled,
      disabled_reason: snoozeEnabled
        ? null
        : !write
          ? permReason
          : 'דחייה אינה זמינה במצב הנוכחי',
      reason_key: snoozeEnabled ? null : !write ? 'missing_permission' : 'candidate_not_approvable_status',
      command: 'snooze_reminder_candidate',
      command_payload: {
        ...payloadBase,
        snooze_presets: REMINDER_SNOOZE_PRESETS.map((p) => ({
          preset_key: p.preset_key,
          label: p.label,
        })),
      },
    },
  ];
}

export async function buildCollectionReminderReviewAggregate(params: {
  orgId: string;
  reminderCandidateId: string;
  viewer?: ReminderReviewViewerContext | null;
  todayIso?: string;
}): Promise<CollectionReminderReviewAggregate> {
  if (!isUuid(params.reminderCandidateId)) {
    throw badRequest('reminder_candidate_id must be a uuid');
  }

  const candidate = await loadReminderCandidate(params.orgId, params.reminderCandidateId);

  const { data: workItem, error: wErr } = await supabaseAdmin
    .from('work_items')
    .select('id, client_id, work_type, work_state, period_key, source_entity_id, source_entity_type')
    .eq('org_id', params.orgId)
    .eq('id', candidate.work_item_id)
    .maybeSingle();
  if (wErr) throw wErr;
  if (!workItem) throw notFound('Work item not found');

  if (String(workItem.work_type) !== INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE) {
    throw badRequest(
      'Candidate is not linked to an invoice collection work item',
      'not_collection_reminder_candidate',
    );
  }

  const incomeDocumentId = String(workItem.source_entity_id ?? '').trim();
  if (!incomeDocumentId || !isUuid(incomeDocumentId)) {
    throw badRequest('Collection work item has no income document linkage');
  }

  const todayIso = params.todayIso ?? backendTodayIsoDate();
  const { data: doc, error: dErr } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, represented_client_id, document_number, document_type, document_status, issue_date, due_date, currency, totals_snapshot_json',
    )
    .eq('organization_id', params.orgId)
    .eq('id', incomeDocumentId)
    .maybeSingle();
  if (dErr) throw dErr;
  if (!doc) throw notFound('Income document not found');

  const representedClientId = doc.represented_client_id
    ? String(doc.represented_client_id)
    : null;
  const workClientId = workItem.client_id ? String(workItem.client_id) : null;
  if (
    representedClientId &&
    workClientId &&
    representedClientId !== workClientId
  ) {
    throw forbidden('Collection candidate client mismatch');
  }
  if (
    candidate.client_id &&
    representedClientId &&
    candidate.client_id !== representedClientId
  ) {
    throw forbidden('Collection candidate client mismatch');
  }

  const paidMap = await sumPostedAllocationsForIncomeDocuments(params.orgId, [
    incomeDocumentId,
  ]);
  const paidAmount = paidMap.get(incomeDocumentId) ?? 0;
  const originalAmount = resolveIncomeInvoiceOriginalAmount(
    doc.totals_snapshot_json as Record<string, unknown> | null,
  );
  const intake = resolveIncomeOverdueCollectionIntake({
    documentStatus: String(doc.document_status),
    documentType: String(doc.document_type),
    dueDate: doc.due_date as string | null,
    originalAmount,
    paidAmount,
    todayIso,
  });

  const truth = composeCollectionReminderInvoiceTruth({
    incomeDocumentId,
    documentNumber: String(doc.document_number ?? ''),
    documentDate: (doc.issue_date as string | null) ?? null,
    dueDate: (doc.due_date as string | null) ?? null,
    daysOverdue: intake.days_overdue,
    currency: String(doc.currency ?? 'ILS'),
    originalAmount,
    paidAmount,
    remainingBalance: intake.remaining_balance,
    paymentStateKey: intake.payment_state_key,
    clientId: representedClientId,
  });

  let clientName: string | null = null;
  let clientEmail: string | null = null;
  if (representedClientId) {
    const { data: client, error: cErr } = await supabaseAdmin
      .from('clients')
      .select('display_name, email')
      .eq('organization_id', params.orgId)
      .eq('id', representedClientId)
      .maybeSingle();
    if (cErr) throw cErr;
    clientName = client?.display_name?.trim() || representedClientId;
    clientEmail = client?.email?.trim() || null;
  }

  const channels = parseChannels(candidate.channel_order_snapshot, candidate.channel);
  const primaryChannel = candidate.channel || channels[0] || null;
  const messageBody = (candidate.edited_body ?? candidate.body).trim();
  const write = canWrite(params.viewer);
  const approveGate = resolveCollectionReminderApproveGate({
    workType: String(workItem.work_type),
    candidateStatus: candidate.status,
    stillOpenOverdue: intake.eligible,
    paymentStateKey: intake.payment_state_key,
    remainingBalance: intake.remaining_balance,
    messageBody,
    canWrite: write,
    hasDeliveryChannel: channels.length > 0,
  });
  const hasRecipient =
    primaryChannel === 'email' ? !!clientEmail : !!representedClientId;
  const sendGate = resolveCollectionReminderSendGate({
    workType: String(workItem.work_type),
    candidateStatus: candidate.status,
    stillOpenOverdue: intake.eligible,
    paymentStateKey: intake.payment_state_key,
    remainingBalance: intake.remaining_balance,
    messageBody,
    canWrite: write,
    hasDeliveryChannel: channels.length > 0,
    hasRecipient,
  });

  const deliveryAttempts = await listAttempts({
    organizationId: params.orgId,
    sourceModule: COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
    sourceEntityType: COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
    sourceEntityId: candidate.id,
    limit: 50,
  });
  const lastAttempt = deliveryAttempts[0] ?? null;

  const slaSnap = (candidate.sla_context_snapshot ?? {}) as Record<string, unknown>;
  const dueAt =
    candidate.suggested_send_at ??
    (slaSnap.due_at ? String(slaSnap.due_at) : null);

  return {
    aggregate_key: COLLECTION_REMINDER_REVIEW_AGGREGATE_KEY,
    ui: {
      title: 'בדיקת תזכורת גבייה',
      subtitle:
        candidate.status === 'approved' || candidate.status === 'delivery_failed'
          ? 'מאושר — ניתן לשלוח'
          : 'אישור מכין לשליחה; השליחה בפקודה נפרדת',
      approve_means_ready_for_delivery: true,
      approve_does_not_send: true,
    },
    candidate: {
      id: candidate.id,
      status: candidate.status,
      workflow_type: candidate.workflow_type,
      step_key: candidate.step_key,
      created_at: candidate.created_at,
      due_at: dueAt,
      version: candidate.version,
      snoozed_until: candidate.snoozed_until,
    },
    work_item: {
      id: String(workItem.id),
      work_type: String(workItem.work_type),
      work_state: String(workItem.work_state),
      period_key: workItem.period_key ? String(workItem.period_key) : null,
    },
    invoice: {
      income_document_id: truth.income_document_id,
      document_number: truth.document_number,
      document_type: String(doc.document_type),
      issue_date: truth.document_date,
      due_date: truth.due_date,
      days_overdue: truth.days_overdue,
    },
    financial: {
      currency: truth.currency,
      original_amount: truth.original_amount,
      paid_amount: truth.paid_amount,
      remaining_balance: truth.remaining_balance,
      payment_state_key: truth.payment_state_key,
      financial_source: 'accounting_base',
    },
    client: {
      represented_client_id: representedClientId,
      display_name: clientName,
    },
    message: {
      subject: candidate.subject?.trim() || null,
      body: messageBody,
      language: null,
      editable_fields: ['subject', 'body'],
    },
    delivery: {
      available_channels: channels,
      primary_channel: primaryChannel,
      target_type: candidate.target_type,
      recipient: {
        client_id: candidate.client_id,
        target_user_id: null,
      },
      history: {
        attempt_count: deliveryAttempts.length,
        last_attempt_at: lastAttempt?.sentAt ?? lastAttempt?.createdAt ?? null,
        last_result: lastAttempt?.result ?? null,
        last_channel: lastAttempt?.channel ?? null,
        attempts: deliveryAttempts.map((a) => ({
          id: a.id,
          channel: a.channel,
          result: a.result,
          created_at: a.createdAt,
          sent_at: a.sentAt,
          failure_reason: a.failureReason,
        })),
      },
    },
    collection_eligibility: {
      still_open_overdue: intake.eligible,
      approve_block_reason_key: approveGate.reason_key,
      send_block_reason_key: sendGate.reason_key,
    },
    allowed_actions: buildCollectionAllowedActions({
      candidate,
      viewer: params.viewer ?? null,
      approveGate,
      sendGate,
    }),
  };
}

/** Assert collection linkage + current AB open-overdue for approve command. */
export async function assertCollectionReminderApprovable(params: {
  orgId: string;
  candidate: ReminderCandidateRow;
  todayIso?: string;
}): Promise<void> {
  const { data: workItem, error } = await supabaseAdmin
    .from('work_items')
    .select('id, work_type, client_id, source_entity_id')
    .eq('org_id', params.orgId)
    .eq('id', params.candidate.work_item_id)
    .maybeSingle();
  if (error) throw error;
  if (!workItem) throw notFound('Work item not found');
  if (String(workItem.work_type) !== INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE) {
    throw badRequest(
      'Candidate is not linked to an invoice collection work item',
      'not_collection_reminder_candidate',
    );
  }

  const incomeDocumentId = String(workItem.source_entity_id ?? '').trim();
  const { data: doc, error: dErr } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, represented_client_id, document_status, document_type, due_date, totals_snapshot_json',
    )
    .eq('organization_id', params.orgId)
    .eq('id', incomeDocumentId)
    .maybeSingle();
  if (dErr) throw dErr;
  if (!doc) throw notFound('Income document not found');

  const paidMap = await sumPostedAllocationsForIncomeDocuments(params.orgId, [
    incomeDocumentId,
  ]);
  const paidAmount = paidMap.get(incomeDocumentId) ?? 0;
  const originalAmount = resolveIncomeInvoiceOriginalAmount(
    doc.totals_snapshot_json as Record<string, unknown> | null,
  );
  const intake = resolveIncomeOverdueCollectionIntake({
    documentStatus: String(doc.document_status),
    documentType: String(doc.document_type),
    dueDate: doc.due_date as string | null,
    originalAmount,
    paidAmount,
    todayIso: params.todayIso ?? backendTodayIsoDate(),
  });

  const channels = parseChannels(
    params.candidate.channel_order_snapshot,
    params.candidate.channel,
  );
  const messageBody = (params.candidate.edited_body ?? params.candidate.body).trim();
  const gate = resolveCollectionReminderApproveGate({
    workType: String(workItem.work_type),
    candidateStatus: params.candidate.status,
    stillOpenOverdue: intake.eligible,
    paymentStateKey: intake.payment_state_key,
    remainingBalance: intake.remaining_balance,
    messageBody,
    canWrite: true,
    hasDeliveryChannel: channels.length > 0,
  });

  if (!gate.allowed) {
    throw badRequest(
      gate.disabled_reason ?? 'Collection reminder cannot be approved',
      gate.reason_key ?? 'collection_reminder_not_approvable',
    );
  }
}

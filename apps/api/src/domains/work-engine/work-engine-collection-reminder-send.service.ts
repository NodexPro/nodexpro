/**
 * INV-4D — send approved collection reminder via Delivery / DocFlow.
 * Reuses platform delivery_attempts ledger. No second delivery engine.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import {
  beginAttempt,
  finalizeAttempt,
  listAttempts,
  sendEmail,
  type DeliveryChannel,
} from '../delivery/index.js';
import { createSystemMessageCore } from '../docflow/docflow-system-message-core.service.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { resolveIncomeInvoiceOriginalAmount } from '../accounting-base/accounting-base-income-payment.pure.js';
import {
  backendTodayIsoDate,
  resolveIncomeOverdueCollectionIntake,
} from '../income/invoice-lifecycle.pure.js';
import {
  buildCollectionReminderSendIdempotencyKey,
  COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
  COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
  composeCollectionReminderSendMessage,
  INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
  resolveCollectionReminderSendGate,
} from './work-engine-collection-reminder.pure.js';
import {
  loadReminderCandidate,
  type ReminderCandidateRow,
} from './work-engine.reminder-review.service.js';

export type SendCollectionReminderResult = {
  candidateId: string;
  status: string;
  deliveryAttemptId: string | null;
  deliveryResult: 'sent' | 'failed' | 'queued' | null;
  channel: string | null;
  idempotentReplay: boolean;
  failureReason: string | null;
};

function parsePrimaryChannel(candidate: ReminderCandidateRow): DeliveryChannel {
  const primary = String(candidate.channel ?? '')
    .trim()
    .toLowerCase()
    .split(':')[0];
  if (primary === 'email' || primary === 'docflow') return primary;
  const order = Array.isArray(candidate.channel_order_snapshot)
    ? candidate.channel_order_snapshot
    : [];
  for (const item of order) {
    const key = String(item ?? '')
      .trim()
      .toLowerCase()
      .split(':')[0];
    if (key === 'email' || key === 'docflow') return key;
  }
  return 'docflow';
}

async function countPriorDeliveryAttempts(
  orgId: string,
  candidateId: string,
): Promise<number> {
  const rows = await listAttempts({
    organizationId: orgId,
    sourceModule: COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
    sourceEntityType: COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
    sourceEntityId: candidateId,
    limit: 100,
  });
  return rows.length;
}

async function markCandidateSending(params: {
  orgId: string;
  candidate: ReminderCandidateRow;
}): Promise<ReminderCandidateRow> {
  if (params.candidate.status === 'sending') return params.candidate;
  const { data, error } = await supabaseAdmin
    .from('work_reminder_candidates')
    .update({
      status: 'sending',
      delivery_status: 'pending_dispatch',
      delivery_error: null,
      version: params.candidate.version + 1,
    })
    .eq('org_id', params.orgId)
    .eq('id', params.candidate.id)
    .eq('version', params.candidate.version)
    .in('status', ['approved', 'delivery_failed'])
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const latest = await loadReminderCandidate(params.orgId, params.candidate.id);
    if (latest.status === 'sent') return latest;
    if (latest.status === 'sending') return latest;
    throw conflict('Reminder candidate was updated by another session');
  }
  return data as ReminderCandidateRow;
}

async function markCandidateTerminal(params: {
  orgId: string;
  candidate: ReminderCandidateRow;
  status: 'sent' | 'delivery_failed';
  deliveryStatus: 'delivered' | 'failed' | 'pending_dispatch';
  deliveryError: string | null;
  actorUserId: string | null;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('work_reminder_candidates')
    .update({
      status: params.status,
      delivery_status: params.deliveryStatus,
      delivery_error: params.deliveryError,
      sent_at: params.status === 'sent' ? nowIso : null,
      version: params.candidate.version + 1,
    })
    .eq('org_id', params.orgId)
    .eq('id', params.candidate.id)
    .eq('version', params.candidate.version);
  if (error) throw error;

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'work_engine',
    entityType: 'work_reminder_candidate',
    entityId: params.candidate.id,
    action:
      params.status === 'sent'
        ? AUDIT_ACTIONS.REMINDER_CANDIDATE_SENT
        : AUDIT_ACTIONS.REMINDER_DELIVERY_FAILED,
    payload: {
      work_item_id: params.candidate.work_item_id,
      delivery_status: params.deliveryStatus,
      delivery_error: params.deliveryError,
    },
  });
}

export async function sendCollectionReminder(params: {
  orgId: string;
  actorUserId: string;
  candidateId: string;
  expectedVersion: number;
  todayIso?: string;
}): Promise<SendCollectionReminderResult> {
  let candidate = await loadReminderCandidate(params.orgId, params.candidateId);
  if (candidate.version !== params.expectedVersion) {
    throw conflict('Reminder candidate was updated by another session');
  }

  if (candidate.status === 'sent') {
    const prior = await listAttempts({
      organizationId: params.orgId,
      sourceModule: COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
      sourceEntityType: COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
      sourceEntityId: candidate.id,
      limit: 1,
    });
    return {
      candidateId: candidate.id,
      status: 'sent',
      deliveryAttemptId: prior[0]?.id ?? null,
      deliveryResult: prior[0]?.result === 'sent' ? 'sent' : 'queued',
      channel: prior[0]?.channel ?? candidate.channel,
      idempotentReplay: true,
      failureReason: null,
    };
  }

  const { data: workItem, error: wErr } = await supabaseAdmin
    .from('work_items')
    .select('id, client_id, work_type, work_state, source_entity_id')
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
  const { data: doc, error: dErr } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, represented_client_id, document_number, document_type, document_status, due_date, currency, totals_snapshot_json, customer_snapshot_json',
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

  const channel = parsePrimaryChannel(candidate);
  const clientId =
    (doc.represented_client_id ? String(doc.represented_client_id) : null) ??
    (workItem.client_id ? String(workItem.client_id) : null) ??
    candidate.client_id;

  let recipientEmail: string | null = null;
  if (channel === 'email' && clientId) {
    const { data: client, error: cErr } = await supabaseAdmin
      .from('clients')
      .select('email')
      .eq('organization_id', params.orgId)
      .eq('id', clientId)
      .maybeSingle();
    if (cErr) throw cErr;
    recipientEmail = client?.email?.trim() || null;
    if (!recipientEmail) {
      const snap = (doc.customer_snapshot_json ?? {}) as Record<string, unknown>;
      const snapEmail = snap.email ?? snap.customer_email;
      recipientEmail =
        snapEmail != null && String(snapEmail).trim() ? String(snapEmail).trim() : null;
    }
  }

  const messageBody = (candidate.edited_body ?? candidate.body).trim();
  const hasRecipient = channel === 'docflow' ? !!clientId : !!recipientEmail;
  const gate = resolveCollectionReminderSendGate({
    workType: String(workItem.work_type),
    candidateStatus: candidate.status,
    stillOpenOverdue: intake.eligible,
    paymentStateKey: intake.payment_state_key,
    remainingBalance: intake.remaining_balance,
    messageBody,
    canWrite: true,
    hasDeliveryChannel: true,
    hasRecipient,
  });
  if (!gate.allowed) {
    throw badRequest(
      gate.disabled_reason ?? 'Collection reminder cannot be sent',
      gate.reason_key ?? 'collection_reminder_not_sendable',
    );
  }

  const sendMessage = composeCollectionReminderSendMessage({
    subject: candidate.subject,
    body: messageBody,
    documentNumber: String(doc.document_number ?? ''),
    remainingBalance: intake.remaining_balance,
    currency: String(doc.currency ?? 'ILS'),
    daysOverdue: intake.days_overdue,
    paymentStateKey: intake.payment_state_key,
  });

  candidate = await markCandidateSending({ orgId: params.orgId, candidate });
  if (candidate.status === 'sent') {
    return {
      candidateId: candidate.id,
      status: 'sent',
      deliveryAttemptId: null,
      deliveryResult: 'sent',
      channel,
      idempotentReplay: true,
      failureReason: null,
    };
  }

  const attemptOrdinal = (await countPriorDeliveryAttempts(params.orgId, candidate.id)) + 1;
  const idempotencyKey = buildCollectionReminderSendIdempotencyKey({
    candidateId: candidate.id,
    attemptOrdinal,
  });

  if (!clientId) throw badRequest('Collection reminder has no client target', 'missing_recipient');

  const attempt = await beginAttempt({
    organizationId: params.orgId,
    representedClientId: clientId,
    sourceModule: COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
    sourceEntityType: COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
    sourceEntityId: candidate.id,
    channel,
    recipientEmail,
    senderSnapshotJson: {
      actor_user_id: params.actorUserId,
      workflow: 'invoice_collection_followup',
    },
    messageSnapshotJson: {
      subject: sendMessage.subject,
      body: sendMessage.body,
      income_document_id: incomeDocumentId,
      remaining_balance: intake.remaining_balance,
      currency: String(doc.currency ?? 'ILS'),
      payment_state_key: intake.payment_state_key,
      days_overdue: intake.days_overdue,
    },
    idempotencyKey,
    sentByUserId: params.actorUserId,
  });

  if (attempt.result === 'sent' || attempt.result === 'failed') {
    await markCandidateTerminal({
      orgId: params.orgId,
      candidate,
      status: attempt.result === 'sent' ? 'sent' : 'delivery_failed',
      deliveryStatus: attempt.result === 'sent' ? 'delivered' : 'failed',
      deliveryError: attempt.failureReason,
      actorUserId: params.actorUserId,
    });
    return {
      candidateId: candidate.id,
      status: attempt.result === 'sent' ? 'sent' : 'delivery_failed',
      deliveryAttemptId: attempt.id,
      deliveryResult: attempt.result,
      channel: attempt.channel,
      idempotentReplay: true,
      failureReason: attempt.failureReason,
    };
  }

  try {
    if (channel === 'docflow') {
      const docflow = await createSystemMessageCore({
        orgId: params.orgId,
        clientId,
        moduleKey: 'income',
        messageType: 'reminder',
        body: sendMessage.body,
        idempotencyKey: `collection_reminder_candidate:${candidate.id}:${attemptOrdinal}`,
        ruleCode: 'work_engine_collection_reminder_send',
        ruleContextKey: candidate.id,
        sendModeRaw: 'auto_send_allowed',
        autoSendAllowedByRule: true,
        allowPublishWithoutAutoSendRule: true,
        threadIdInput: null,
        actorUserId: params.actorUserId,
      });
      await finalizeAttempt({
        attemptId: attempt.id,
        organizationId: params.orgId,
        result: 'sent',
        docflowThreadId: docflow.threadId,
        docflowMessageId: docflow.messageId,
      });
      await markCandidateTerminal({
        orgId: params.orgId,
        candidate,
        status: 'sent',
        deliveryStatus: 'delivered',
        deliveryError: null,
        actorUserId: params.actorUserId,
      });
      return {
        candidateId: candidate.id,
        status: 'sent',
        deliveryAttemptId: attempt.id,
        deliveryResult: 'sent',
        channel,
        idempotentReplay: docflow.reusedExisting,
        failureReason: null,
      };
    }

    const emailResult = await sendEmail({
      organizationId: params.orgId,
      to: recipientEmail!,
      subject: sendMessage.subject,
      body_text: sendMessage.body,
      body_html: `<pre>${sendMessage.body.replace(/</g, '&lt;')}</pre>`,
      attachments: [],
    });
    if (emailResult.status !== 'sent') {
      const reason = emailResult.failure_reason ?? 'Email send failed';
      await finalizeAttempt({
        attemptId: attempt.id,
        organizationId: params.orgId,
        result: 'failed',
        failureReason: reason,
      });
      await markCandidateTerminal({
        orgId: params.orgId,
        candidate,
        status: 'delivery_failed',
        deliveryStatus: 'failed',
        deliveryError: reason,
        actorUserId: params.actorUserId,
      });
      return {
        candidateId: candidate.id,
        status: 'delivery_failed',
        deliveryAttemptId: attempt.id,
        deliveryResult: 'failed',
        channel,
        idempotentReplay: false,
        failureReason: reason,
      };
    }

    await finalizeAttempt({
      attemptId: attempt.id,
      organizationId: params.orgId,
      result: 'sent',
      providerMessageId: emailResult.provider_message_id ?? null,
    });
    await markCandidateTerminal({
      orgId: params.orgId,
      candidate,
      status: 'sent',
      deliveryStatus: 'delivered',
      deliveryError: null,
      actorUserId: params.actorUserId,
    });
    return {
      candidateId: candidate.id,
      status: 'sent',
      deliveryAttemptId: attempt.id,
      deliveryResult: 'sent',
      channel,
      idempotentReplay: false,
      failureReason: null,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Delivery failed';
    try {
      await finalizeAttempt({
        attemptId: attempt.id,
        organizationId: params.orgId,
        result: 'failed',
        failureReason: reason,
      });
    } catch {
      // best-effort finalize
    }
    await markCandidateTerminal({
      orgId: params.orgId,
      candidate,
      status: 'delivery_failed',
      deliveryStatus: 'failed',
      deliveryError: reason,
      actorUserId: params.actorUserId,
    });
    return {
      candidateId: candidate.id,
      status: 'delivery_failed',
      deliveryAttemptId: attempt.id,
      deliveryResult: 'failed',
      channel,
      idempotentReplay: false,
      failureReason: reason,
    };
  }
}

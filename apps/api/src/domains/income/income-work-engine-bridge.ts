/**
 * INC-8 — Income → Work Engine bridge (work_events intake only).
 *
 * STRICT:
 *   - No direct work_items / work_events writes.
 *   - Only `intakeWorkEvent` from work-engine.event-intake.service.
 *   - Fire-and-forget; never throws into Income command handlers.
 *   - amount_reference in payload is display-only (not Work Engine financial truth).
 *
 * Client contract:
 *   - `represented_client_id` (office_representative mode) is used as Work Engine client_id.
 *   - Self-mode documents without represented_client_id are skipped (logged); intake requires client_id.
 */

import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { intakeWorkEvent } from '../work-engine/work-engine.event-intake.service.js';
import type { IntakeWorkEventMeta } from '../work-engine/work-engine.types.js';
import { supabaseAdmin } from '../../db/client.js';
import {
  INCOME_WORK_ENGINE_ENTITY_TYPE,
  INCOME_WORK_ENGINE_SCHEMA_VERSION,
  INCOME_WORK_ENGINE_SOURCE_MODULE,
  INCOME_WORK_EVENT_CREDIT_ISSUED,
  INCOME_WORK_EVENT_DOCUMENT_ISSUED,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
  INCOME_WORK_EVENT_DUE_DATE_SET,
  INCOME_WORK_EVENT_OVERDUE,
  amountReferenceFromTotalsSnapshot,
  customerDisplayFromSnapshot,
  incomeDocumentPeriodKey,
  isCreditIncomeDocumentType,
  isOverdueByDueDate,
  resolveIncomeWorkEngineClientId,
} from './income-work-engine-bridge.pure.js';

export type IncomeWorkEventEmitContext = {
  ctx: RequestContext;
  orgId: string;
  incomeDocumentId: string;
  representedClientId: string | null;
  documentType: string;
  documentNumber: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  customerSnapshotJson: Record<string, unknown>;
  totalsSnapshotJson: Record<string, unknown> | null;
};

function buildIntakePayload(
  signal: IncomeWorkEventEmitContext,
  eventType: string,
  clientId: string,
  extraPayload: Record<string, unknown>,
): Record<string, unknown> {
  const periodSource = signal.dueDate ?? signal.issueDate;
  const amountReference = amountReferenceFromTotalsSnapshot(signal.totalsSnapshotJson);
  return {
    org_id: signal.orgId,
    client_id: clientId,
    source_module: INCOME_WORK_ENGINE_SOURCE_MODULE,
    source_entity_type: INCOME_WORK_ENGINE_ENTITY_TYPE,
    source_entity_id: signal.incomeDocumentId,
    event_type: eventType,
    period_key: incomeDocumentPeriodKey(periodSource),
    occurred_at: new Date().toISOString(),
    schema_version: INCOME_WORK_ENGINE_SCHEMA_VERSION,
    emitted_by_type: 'system',
    emitted_by_id: null,
    payload: {
      document_number: signal.documentNumber,
      document_type: signal.documentType,
      issue_date: signal.issueDate,
      due_date: signal.dueDate,
      currency: signal.currency,
      amount_reference: amountReference,
      customer_display_name: customerDisplayFromSnapshot(signal.customerSnapshotJson),
      ...extraPayload,
    },
  };
}

async function auditBridgeFailure(
  signal: IncomeWorkEventEmitContext,
  eventType: string,
  error: string,
): Promise<void> {
  try {
    await writeAudit({
      organizationId: signal.orgId,
      actorUserId: signal.ctx.user.id,
      moduleCode: 'income',
      entityType: 'income_document',
      entityId: signal.incomeDocumentId,
      action: AUDIT_ACTIONS.INCOME_WORK_ENGINE_BRIDGE_INTAKE_FAILED,
      payload: { event_type: eventType, error },
    });
  } catch {
    // best-effort
  }
}

async function emitIntake(
  signal: IncomeWorkEventEmitContext,
  eventType: string,
  extraPayload: Record<string, unknown> = {},
): Promise<IntakeWorkEventMeta | null> {
  const clientId = resolveIncomeWorkEngineClientId(signal.representedClientId);
  if (!clientId) return null;

  const body = buildIntakePayload(signal, eventType, clientId, extraPayload);
  try {
    return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    await auditBridgeFailure(signal, eventType, msg);
    return null;
  }
}

/**
 * Emit safe Income work events after a document is issued.
 * Maps to work_items only via Work Engine allowlist (currently: overdue scan path + overdue event).
 */
export async function emitIncomeWorkEventsAfterDocumentIssued(
  signal: IncomeWorkEventEmitContext,
): Promise<void> {
  const clientId = resolveIncomeWorkEngineClientId(signal.representedClientId);
  if (!clientId) {
    await auditBridgeFailure(
      signal,
      INCOME_WORK_EVENT_DOCUMENT_ISSUED,
      'represented_client_id required for Work Engine intake (self-mode skipped)',
    );
    return;
  }

  await emitIntake(signal, INCOME_WORK_EVENT_DOCUMENT_ISSUED);

  if (signal.dueDate) {
    await emitIntake(signal, INCOME_WORK_EVENT_DUE_DATE_SET);
    const today = new Date().toISOString().slice(0, 10);
    if (isOverdueByDueDate(signal.dueDate, today)) {
      await emitIntake(signal, INCOME_WORK_EVENT_OVERDUE, {
        overdue_since: today,
      });
    }
  }

  if (isCreditIncomeDocumentType(signal.documentType)) {
    await emitIntake(signal, INCOME_WORK_EVENT_CREDIT_ISSUED);
  }
}

export type IncomeDocumentEmailSentEmitContext = IncomeWorkEventEmitContext & {
  recipientEmail: string;
  deliveryAttemptId: string;
  providerMessageId: string | null;
};

/**
 * Emit fact after a successful email delivery attempt (fire-and-forget).
 */
export async function emitIncomeWorkEventAfterDocumentSentByEmail(
  signal: IncomeDocumentEmailSentEmitContext,
): Promise<void> {
  const clientId = resolveIncomeWorkEngineClientId(signal.representedClientId);
  if (!clientId) {
    await auditBridgeFailure(
      signal,
      INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
      'represented_client_id required for Work Engine intake (self-mode skipped)',
    );
    return;
  }

  await emitIntake(signal, INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL, {
    channel: 'email',
    recipient_email: signal.recipientEmail,
    delivery_attempt_id: signal.deliveryAttemptId,
    provider_message_id: signal.providerMessageId,
  });
}

/**
 * Scheduler hook: emit overdue events for issued documents with past due_date.
 * Does not compute debt totals — compares due_date only (display/reference workflow).
 */
export async function scanAndEmitIncomeInvoiceOverdueForOrg(
  orgId: string,
  ctx: RequestContext,
  todayIso: string = new Date().toISOString().slice(0, 10),
): Promise<{ scanned: number; emitted: number }> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, represented_client_id, document_type, document_number, issue_date, due_date, currency, customer_snapshot_json, totals_snapshot_json',
    )
    .eq('organization_id', orgId)
    .eq('document_status', 'issued')
    .not('represented_client_id', 'is', null)
    .not('due_date', 'is', null)
    .lt('due_date', todayIso)
    .limit(200);
  if (error) throw error;

  let emitted = 0;
  for (const row of data ?? []) {
    const r = row as {
      id: string;
      represented_client_id: string;
      document_type: string;
      document_number: string;
      issue_date: string;
      due_date: string;
      currency: string;
      customer_snapshot_json: Record<string, unknown>;
      totals_snapshot_json: Record<string, unknown> | null;
    };
    const signal: IncomeWorkEventEmitContext = {
      ctx,
      orgId,
      incomeDocumentId: r.id,
      representedClientId: r.represented_client_id,
      documentType: r.document_type,
      documentNumber: r.document_number,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      currency: r.currency ?? 'ILS',
      customerSnapshotJson: r.customer_snapshot_json ?? {},
      totalsSnapshotJson: r.totals_snapshot_json,
    };
    const out = await emitIntake(signal, INCOME_WORK_EVENT_OVERDUE, {
      overdue_since: todayIso,
    });
    if (out) emitted += 1;
  }
  return { scanned: (data ?? []).length, emitted };
}

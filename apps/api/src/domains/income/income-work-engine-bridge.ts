/**
 * INC-8 / INV-4A — Income → Work Engine bridge (work_events intake only).
 *
 * STRICT:
 *   - No direct work_items / work_events writes.
 *   - Only `intakeWorkEvent` from work-engine.event-intake.service.
 *   - Fire-and-forget; never throws into Income command handlers.
 *   - amount / remaining references are display-only (not Work Engine financial truth).
 *
 * Client contract:
 *   - `represented_client_id` (office_representative mode) is used as Work Engine client_id.
 *   - Self-mode / office-owned invoices (represented_client_id null) are skipped (audited).
 *
 * INV-4A overdue intake:
 *   - AB remaining + INV-2 overdue (not due_date-only)
 *   - tax_invoice only (isSupportedIncomePaymentDocumentType)
 *   - period_key = invoice:<id> (per-invoice collection work item)
 *   - ordered paginated catch-up (not hard-stuck on first 200)
 */

import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { intakeWorkEvent } from '../work-engine/work-engine.event-intake.service.js';
import type { IntakeWorkEventMeta } from '../work-engine/work-engine.types.js';
import { supabaseAdmin } from '../../db/client.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { loadIssuedCreditAmountsByInvoice } from './income-document-tax-invoice-credit.service.js';
import { composeCollectibleAfterCredit } from './income-document-tax-invoice-credit.pure.js';
import {
  isSupportedIncomePaymentDocumentType,
  resolveIncomeInvoiceOriginalAmount,
} from '../accounting-base/accounting-base-income-payment.pure.js';
import { resolveIncomeOverdueCollectionIntake } from './invoice-lifecycle.pure.js';
import {
  INCOME_OVERDUE_SCAN_MAX_PAGES,
  INCOME_OVERDUE_SCAN_PAGE_SIZE,
  INCOME_WORK_ENGINE_ENTITY_TYPE,
  INCOME_WORK_ENGINE_SCHEMA_VERSION,
  INCOME_WORK_ENGINE_SOURCE_MODULE,
  INCOME_WORK_EVENT_CREDIT_ISSUED,
  INCOME_WORK_EVENT_DOCUMENT_ISSUED,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
  INCOME_WORK_EVENT_DUE_DATE_SET,
  INCOME_WORK_EVENT_OVERDUE,
  INCOME_WORK_EVENTS_DEFERRED,
  amountReferenceFromTotalsSnapshot,
  customerDisplayFromSnapshot,
  incomeDocumentPeriodKey,
  incomeInvoiceCollectionPeriodKey,
  isCreditIncomeDocumentType,
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
  periodKey?: string,
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
    period_key: periodKey ?? incomeDocumentPeriodKey(periodSource),
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
  periodKey?: string,
): Promise<IntakeWorkEventMeta | null> {
  const clientId = resolveIncomeWorkEngineClientId(signal.representedClientId);
  if (!clientId) return null;

  const body = buildIntakePayload(signal, eventType, clientId, extraPayload, periodKey);
  try {
    return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    await auditBridgeFailure(signal, eventType, msg);
    return null;
  }
}

async function emitOverdueIntakeIfEligible(
  signal: IncomeWorkEventEmitContext,
  todayIso: string,
  paidAmount: number,
): Promise<IntakeWorkEventMeta | null> {
  const original = resolveIncomeInvoiceOriginalAmount(signal.totalsSnapshotJson);
  const credited = (await loadIssuedCreditAmountsByInvoice(signal.orgId, [signal.incomeDocumentId])).get(
    signal.incomeDocumentId,
  ) ?? 0;
  const collectible = composeCollectibleAfterCredit({
    originalAmount: original,
    creditedAmount: credited,
    allocatedPayments: paidAmount,
  });
  const intake = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: signal.documentType,
    dueDate: signal.dueDate,
    originalAmount: collectible.net_invoice_amount,
    paidAmount,
    todayIso,
  });
  if (!intake.eligible) return null;

  return emitIntake(
    signal,
    INCOME_WORK_EVENT_OVERDUE,
    {
      overdue_since: intake.overdue_since,
      days_overdue: intake.days_overdue,
      remaining_balance_reference: intake.remaining_balance,
      payment_state_key: intake.payment_state_key,
      original_amount_reference: original,
    },
    incomeInvoiceCollectionPeriodKey(signal.incomeDocumentId),
  );
}

/**
 * Emit safe Income work events after a document is issued.
 * Overdue intake uses AB remaining + INV-2 (INV-4A).
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
    const paidMap = await sumPostedAllocationsForIncomeDocuments(signal.orgId, [
      signal.incomeDocumentId,
    ]);
    await emitOverdueIntakeIfEligible(
      signal,
      today,
      paidMap.get(signal.incomeDocumentId) ?? 0,
    );
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

export type IncomeDocumentDocflowSentEmitContext = IncomeWorkEventEmitContext & {
  deliveryAttemptId: string;
  docflowThreadId: string;
  docflowMessageId: string;
};

/**
 * Emit fact after a successful DocFlow delivery attempt (fire-and-forget).
 */
export async function emitIncomeWorkEventAfterDocumentSentByDocflow(
  signal: IncomeDocumentDocflowSentEmitContext,
): Promise<void> {
  const clientId = resolveIncomeWorkEngineClientId(signal.representedClientId);
  if (!clientId) {
    await auditBridgeFailure(
      signal,
      INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
      'represented_client_id required for Work Engine intake (self-mode skipped)',
    );
    return;
  }

  await emitIntake(signal, INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW, {
    channel: 'docflow',
    delivery_attempt_id: signal.deliveryAttemptId,
    docflow_thread_id: signal.docflowThreadId,
    docflow_message_id: signal.docflowMessageId,
  });
}

export type IncomePaidEventType =
  | (typeof INCOME_WORK_EVENTS_DEFERRED)[0]
  | (typeof INCOME_WORK_EVENTS_DEFERRED)[1];

export type IncomeDocumentPaidEmitContext = IncomeWorkEventEmitContext & {
  eventType: IncomePaidEventType;
  allocatedAmount: number;
  allocatedTotal: number;
  remainingBalance: number;
  paymentId: string;
  allocationId: string;
};

/**
 * INV-5A — emit paid / partially_paid facts after Accounting Base allocation.
 * amount fields are reference-only (Work Engine must not become financial truth).
 */
export async function emitIncomeWorkEventAfterInvoicePaidOrPartial(
  signal: IncomeDocumentPaidEmitContext,
): Promise<IntakeWorkEventMeta | null> {
  const clientId = resolveIncomeWorkEngineClientId(signal.representedClientId);
  if (!clientId) {
    await auditBridgeFailure(
      signal,
      signal.eventType,
      'represented_client_id required for Work Engine intake (self-mode skipped)',
    );
    return null;
  }

  return emitIntake(signal, signal.eventType, {
    allocated_amount_reference: signal.allocatedAmount,
    allocated_total_reference: signal.allocatedTotal,
    remaining_balance_reference: signal.remainingBalance,
    payment_id: signal.paymentId,
    allocation_id: signal.allocationId,
  });
}

type OverdueScanDoc = {
  id: string;
  represented_client_id: string;
  document_type: string;
  document_number: string;
  document_status: string;
  issue_date: string;
  due_date: string;
  currency: string;
  customer_snapshot_json: Record<string, unknown> | null;
  totals_snapshot_json: Record<string, unknown> | null;
};

/**
 * INV-4E — after allocation reversal, re-emit overdue when AB remaining > 0 and still overdue.
 * Creates/reuses invoice_collection_followup via existing INV-4A intake (reopen path).
 */
export async function emitIncomeInvoiceOverdueAfterPaymentReversal(
  signal: IncomeWorkEventEmitContext,
  paidAmount: number,
  todayIso: string = new Date().toISOString().slice(0, 10),
): Promise<IntakeWorkEventMeta | null> {
  const clientId = resolveIncomeWorkEngineClientId(signal.representedClientId);
  if (!clientId) {
    await auditBridgeFailure(
      signal,
      INCOME_WORK_EVENT_OVERDUE,
      'represented_client_id required for Work Engine intake after reversal (self-mode skipped)',
    );
    return null;
  }
  return emitOverdueIntakeIfEligible(signal, todayIso, paidAmount);
}

/**
 * INV-4A — scan overdue open tax invoices and intake collection work items.
 * Catch-up: ordered pages (due_date, id); AB remaining batched; idempotent emit/retry.
 */
export async function scanAndEmitIncomeInvoiceOverdueForOrg(
  orgId: string,
  ctx: RequestContext,
  todayIso: string = new Date().toISOString().slice(0, 10),
): Promise<{ scanned: number; emitted: number; pages: number; eligible: number }> {
  let scanned = 0;
  let emitted = 0;
  let eligible = 0;
  let pages = 0;

  for (let page = 0; page < INCOME_OVERDUE_SCAN_MAX_PAGES; page += 1) {
    const from = page * INCOME_OVERDUE_SCAN_PAGE_SIZE;
    const to = from + INCOME_OVERDUE_SCAN_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('income_documents')
      .select(
        'id, represented_client_id, document_type, document_number, document_status, issue_date, due_date, currency, customer_snapshot_json, totals_snapshot_json',
      )
      .eq('organization_id', orgId)
      .eq('document_status', 'issued')
      .eq('document_type', 'tax_invoice')
      .not('represented_client_id', 'is', null)
      .not('due_date', 'is', null)
      .lt('due_date', todayIso)
      .order('due_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as OverdueScanDoc[];
    if (rows.length === 0) break;

    pages += 1;
    scanned += rows.length;

    const ids = rows.map((r) => r.id);
    const [paidMap, creditedMap] = await Promise.all([
      sumPostedAllocationsForIncomeDocuments(orgId, ids),
      loadIssuedCreditAmountsByInvoice(orgId, ids),
    ]);

    for (const r of rows) {
      if (!isSupportedIncomePaymentDocumentType(r.document_type)) continue;
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
      const paid = paidMap.get(r.id) ?? 0;
      const original = resolveIncomeInvoiceOriginalAmount(r.totals_snapshot_json);
      const collectible = composeCollectibleAfterCredit({
        originalAmount: original,
        creditedAmount: creditedMap.get(r.id) ?? 0,
        allocatedPayments: paid,
      });
      const decision = resolveIncomeOverdueCollectionIntake({
        documentStatus: r.document_status,
        documentType: r.document_type,
        dueDate: r.due_date,
        originalAmount: collectible.net_invoice_amount,
        paidAmount: paid,
        todayIso,
      });
      if (!decision.eligible) continue;
      eligible += 1;
      const out = await emitOverdueIntakeIfEligible(signal, todayIso, paid);
      if (out) emitted += 1;
    }

    if (rows.length < INCOME_OVERDUE_SCAN_PAGE_SIZE) break;
  }

  return { scanned, emitted, pages, eligible };
}

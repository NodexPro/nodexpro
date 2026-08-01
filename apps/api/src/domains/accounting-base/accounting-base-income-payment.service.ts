/**
 * INV-5A — record_and_allocate_income_payment (Accounting Base).
 *
 * Financial writes (payment + allocation) go through one SECURITY DEFINER RPC:
 * `accounting_base_record_and_allocate_income_payment` (migration 148).
 * That plpgsql function body is a single database transaction — no app-layer
 * delete compensation for consistency.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { assertRowMatchesIssuerScope } from '../income/income.guards.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import { emitIncomeWorkEventAfterInvoicePaidOrPartial } from '../income/income-work-engine-bridge.js';
import { INCOME_WORK_EVENTS_DEFERRED } from '../income/income-work-engine-bridge.pure.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import {
  ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT,
  ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY,
  ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION,
  incomePaymentMethodLabel,
  isSupportedIncomePaymentDocumentType,
  parseIncomePaymentMethodKey,
  resolveIncomeInvoiceOriginalAmount,
  resolveIncomeInvoicePaymentState,
  roundMoney2,
} from './accounting-base-income-payment.pure.js';
import {
  buildIncomeInvoicePaymentCaseAggregate,
  type IncomeInvoicePaymentCaseAggregate,
} from './accounting-base-income-payment-case.read.js';

export const ACCOUNTING_BASE_RECORD_AND_ALLOCATE_INCOME_PAYMENT_RPC =
  'accounting_base_record_and_allocate_income_payment' as const;

export type RecordAndAllocateIncomePaymentResponse = {
  ok: true;
  command: typeof ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT;
  payment_id: string;
  allocation_id: string;
  refreshed: {
    aggregate_key: typeof ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY;
    aggregate: IncomeInvoicePaymentCaseAggregate;
  };
};

type IncomeDocRow = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  document_type: string;
  document_number: string;
  document_status: string;
  currency: string;
  issue_date: string;
  due_date: string | null;
  totals_snapshot_json: Record<string, unknown> | null;
  customer_snapshot_json: Record<string, unknown> | null;
};

type AtomicPaymentRpcResult = {
  replay: boolean;
  payment_id: string;
  allocation_id: string;
  allocated_total: number;
  remaining_balance: number;
};

function requirePaymentWrite(ctx: RequestContext): void {
  if (!(ctx.membership?.permissions ?? []).includes(ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION)) {
    throw forbidden('accounting_base.payment.write required');
  }
}

function reqIsoDate(value: unknown, field: string): string {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`${field} must be YYYY-MM-DD`);
  return s;
}

function reqPositiveAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw badRequest('amount must be a positive number');
  return roundMoney2(n);
}

function reqCurrency(value: unknown): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) throw badRequest('currency must be a 3-letter code');
  return s;
}

async function loadIncomeDocument(
  organizationId: string,
  incomeDocumentId: string,
): Promise<IncomeDocRow> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, document_status, currency, issue_date, due_date, totals_snapshot_json, customer_snapshot_json',
    )
    .eq('organization_id', organizationId)
    .eq('id', incomeDocumentId)
    .maybeSingle();
  throwIfSupabaseError(error, 'Failed to load income document');
  if (!data) throw notFound('Income document not found');
  return data as IncomeDocRow;
}

async function auditFailure(
  ctx: RequestContext,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: 'accounting_base',
      entityType: 'accounting_payment',
      entityId: typeof payload.payment_id === 'string' ? payload.payment_id : null,
      action: AUDIT_ACTIONS.ACCOUNTING_BASE_PAYMENT_ALLOCATION_FAILED,
      payload,
    });
  } catch {
    // best-effort
  }
}

function mapAtomicPaymentRpcError(err: { message?: string; code?: string }): never {
  const message = String(err.message ?? 'Payment allocation failed');
  if (/already fully paid/i.test(message)) {
    throw conflict('Income document is already fully paid');
  }
  if (/exceeds remaining balance/i.test(message)) {
    throw badRequest('amount exceeds remaining balance');
  }
  if (/Concurrent payment exceeded remaining balance/i.test(message)) {
    throw conflict('Concurrent payment exceeded remaining balance');
  }
  if (/Idempotency key already used/i.test(message)) {
    throw conflict('Idempotency key already used for a different payment allocation');
  }
  if (/Income document not found/i.test(message)) {
    throw notFound('Income document not found');
  }
  if (/amount must be a positive number|original_amount|idempotency_key required/i.test(message)) {
    throw badRequest(message);
  }
  throw new AppError(502, message, 'ACCOUNTING_BASE_PAYMENT_RPC_FAILED', {
    pg_code: err.code,
  });
}

/**
 * Atomic DB write: payment row + allocation row in one plpgsql transaction.
 */
export async function callRecordAndAllocateIncomePaymentRpc(input: {
  organizationId: string;
  incomeDocumentId: string;
  issuerBusinessId: string;
  representedClientId: string | null;
  paymentDate: string;
  paymentMethodKey: string;
  amount: number;
  currency: string;
  referenceNumber: string | null;
  note: string | null;
  idempotencyKey: string;
  createdBy: string;
  originalAmount: number;
}): Promise<AtomicPaymentRpcResult> {
  const { data, error } = await supabaseAdmin.rpc(
    ACCOUNTING_BASE_RECORD_AND_ALLOCATE_INCOME_PAYMENT_RPC,
    {
      p_organization_id: input.organizationId,
      p_income_document_id: input.incomeDocumentId,
      p_issuer_business_id: input.issuerBusinessId,
      p_represented_client_id: input.representedClientId,
      p_payment_date: input.paymentDate,
      p_payment_method_key: input.paymentMethodKey,
      p_amount: input.amount,
      p_currency: input.currency,
      p_reference_number: input.referenceNumber,
      p_note: input.note,
      p_idempotency_key: input.idempotencyKey,
      p_created_by: input.createdBy,
      p_original_amount: input.originalAmount,
    },
  );

  if (error) {
    mapAtomicPaymentRpcError(error);
  }
  if (!data || typeof data !== 'object') {
    throw new AppError(502, 'Payment RPC returned empty result', 'ACCOUNTING_BASE_PAYMENT_RPC_EMPTY');
  }

  const row = data as Record<string, unknown>;
  const paymentId = String(row.payment_id ?? '');
  const allocationId = String(row.allocation_id ?? '');
  if (!paymentId || !allocationId) {
    throw new AppError(502, 'Payment RPC missing ids', 'ACCOUNTING_BASE_PAYMENT_RPC_INVALID');
  }

  return {
    replay: Boolean(row.replay),
    payment_id: paymentId,
    allocation_id: allocationId,
    allocated_total: roundMoney2(Number(row.allocated_total ?? 0)),
    remaining_balance: roundMoney2(Number(row.remaining_balance ?? 0)),
  };
}

export async function executeRecordAndAllocateIncomePayment(
  ctx: RequestContext,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<RecordAndAllocateIncomePaymentResponse> {
  assertOrgInContext(ctx, organizationId);
  requirePaymentWrite(ctx);

  const incomeDocumentId = String(payload.income_document_id ?? '').trim();
  if (!incomeDocumentId) throw badRequest('income_document_id required');
  const idempotencyKey = String(payload.idempotency_key ?? '').trim();
  if (!idempotencyKey) throw badRequest('idempotency_key required');

  const paymentDate = reqIsoDate(payload.payment_date, 'payment_date');
  const amount = reqPositiveAmount(payload.amount);
  const currency = reqCurrency(payload.currency);
  let methodKey;
  try {
    methodKey = parseIncomePaymentMethodKey(payload.payment_method_key);
  } catch {
    throw badRequest('payment_method_key is invalid');
  }
  const referenceNumber =
    payload.reference_number == null || String(payload.reference_number).trim() === ''
      ? null
      : String(payload.reference_number).trim().slice(0, 120);
  const note =
    payload.note == null || String(payload.note).trim() === ''
      ? null
      : String(payload.note).trim().slice(0, 500);

  const doc = await loadIncomeDocument(organizationId, incomeDocumentId);

  try {
    if (doc.document_status !== 'issued') {
      throw badRequest('Only issued income documents can receive payments');
    }
    if (!isSupportedIncomePaymentDocumentType(doc.document_type)) {
      throw badRequest('Only tax_invoice documents are supported for payment allocation');
    }
    if ((doc.currency || 'ILS').toUpperCase() !== currency) {
      throw badRequest('currency must match the income document currency');
    }

    const scope = await loadActiveIncomeIssuerScope(ctx);
    assertRowMatchesIssuerScope(scope, {
      organization_id: doc.organization_id,
      issuer_business_id: doc.issuer_business_id,
      represented_client_id: doc.represented_client_id,
    });

    const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
    if (original <= 0) {
      throw badRequest('Income document has no allocatable original amount');
    }

    const rpcResult = await callRecordAndAllocateIncomePaymentRpc({
      organizationId,
      incomeDocumentId: doc.id,
      issuerBusinessId: doc.issuer_business_id,
      representedClientId: doc.represented_client_id,
      paymentDate,
      paymentMethodKey: methodKey,
      amount,
      currency,
      referenceNumber,
      note,
      idempotencyKey,
      createdBy: ctx.user.id,
      originalAmount: original,
    });

    const paymentId = rpcResult.payment_id;
    const allocationId = rpcResult.allocation_id;
    const allocatedAfter = rpcResult.allocated_total;
    const stateAfter = resolveIncomeInvoicePaymentState(original, allocatedAfter);

    if (!rpcResult.replay) {
      await writeAudit({
        organizationId,
        actorUserId: ctx.user.id,
        moduleCode: 'accounting_base',
        entityType: 'accounting_payment',
        entityId: paymentId,
        action: AUDIT_ACTIONS.ACCOUNTING_BASE_PAYMENT_RECORDED,
        payload: {
          payment_id: paymentId,
          income_document_id: doc.id,
          issuer_business_id: doc.issuer_business_id,
          represented_client_id: doc.represented_client_id,
          amount,
          currency,
          payment_method_key: methodKey,
          payment_method_label: incomePaymentMethodLabel(methodKey),
          payment_date: paymentDate,
          reference_number: referenceNumber,
          idempotency_key: idempotencyKey,
        },
      });

      await writeAudit({
        organizationId,
        actorUserId: ctx.user.id,
        moduleCode: 'accounting_base',
        entityType: 'accounting_payment_allocation',
        entityId: allocationId,
        action: AUDIT_ACTIONS.ACCOUNTING_BASE_PAYMENT_ALLOCATED_TO_INCOME_DOCUMENT,
        payload: {
          payment_id: paymentId,
          allocation_id: allocationId,
          income_document_id: doc.id,
          issuer_business_id: doc.issuer_business_id,
          represented_client_id: doc.represented_client_id,
          allocated_amount: amount,
          currency,
          idempotency_key: idempotencyKey,
          remaining_balance: stateAfter.remaining_balance,
          payment_state_key: stateAfter.payment_state_key,
        },
      });

      const eventType =
        stateAfter.payment_state_key === 'paid'
          ? INCOME_WORK_EVENTS_DEFERRED[0]
          : INCOME_WORK_EVENTS_DEFERRED[1];

      const meta = await emitIncomeWorkEventAfterInvoicePaidOrPartial({
        ctx,
        orgId: organizationId,
        incomeDocumentId: doc.id,
        representedClientId: doc.represented_client_id,
        documentType: doc.document_type,
        documentNumber: doc.document_number,
        issueDate: doc.issue_date,
        dueDate: doc.due_date,
        currency: doc.currency || 'ILS',
        customerSnapshotJson: doc.customer_snapshot_json ?? {},
        totalsSnapshotJson: doc.totals_snapshot_json,
        eventType,
        allocatedAmount: amount,
        allocatedTotal: allocatedAfter,
        remainingBalance: stateAfter.remaining_balance,
        paymentId,
        allocationId,
      });
      if (meta) {
        await writeAudit({
          organizationId,
          actorUserId: ctx.user.id,
          moduleCode: 'accounting_base',
          entityType: 'income_document',
          entityId: doc.id,
          action:
            eventType === INCOME_WORK_EVENTS_DEFERRED[0]
              ? AUDIT_ACTIONS.ACCOUNTING_BASE_INCOME_INVOICE_PAID_EVENT_EMITTED
              : AUDIT_ACTIONS.ACCOUNTING_BASE_INCOME_INVOICE_PARTIALLY_PAID_EVENT_EMITTED,
          payload: {
            event_type: eventType,
            payment_id: paymentId,
            allocation_id: allocationId,
            income_document_id: doc.id,
            issuer_business_id: doc.issuer_business_id,
            represented_client_id: doc.represented_client_id,
            amount,
            currency,
            remaining_balance: stateAfter.remaining_balance,
            idempotency_key: idempotencyKey,
          },
        });
      }
    }

    const aggregate = await buildIncomeInvoicePaymentCaseAggregate(ctx, organizationId, doc.id);
    return {
      ok: true,
      command: ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT,
      payment_id: paymentId,
      allocation_id: allocationId,
      refreshed: {
        aggregate_key: ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY,
        aggregate,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await auditFailure(ctx, organizationId, {
      income_document_id: incomeDocumentId,
      idempotency_key: idempotencyKey,
      amount,
      currency,
      error: message,
    });
    throw err;
  }
}

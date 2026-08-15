/**
 * Accounting Base customer credit — first-class refundable balance.
 * Created when a paid invoice is reduced by a Credit Note. Does not refund cash.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, conflict, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { roundMoney2 } from './accounting-base-income-payment.pure.js';
import {
  CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE,
  CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE,
} from '../income/income-document-tax-invoice-credit.pure.js';

export const ACCOUNTING_BASE_CONSUME_INCOME_TAX_INVOICE_CREDIT_RPC =
  'accounting_base_consume_income_tax_invoice_credit' as const;
export const ACCOUNTING_BASE_REVERSE_INCOME_TAX_INVOICE_CREDIT_CONSUME_RPC =
  'accounting_base_reverse_income_tax_invoice_credit_consume' as const;

export type AccountingCustomerCreditRow = {
  id: string;
  source_invoice_id: string;
  source_credit_document_id: string;
  income_customer_id: string | null;
  amount: number;
  currency: string;
  status: 'open' | 'applied' | 'refunded' | 'reversed';
};

export type AtomicCreditConsumeResult = {
  replay: boolean;
  source_invoice_id: string;
  credited_amount_reference: number;
  remaining_creditable_amount: number;
  remaining_receivable: number | null;
  customer_credit_amount: number;
  customer_credit_id: string | null;
};

function mapCreditConsumeRpcError(err: { message?: string; code?: string }): never {
  const message = String(err.message ?? 'Credit consume failed');
  if (message.includes(CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE)) {
    throw conflict('סכום הזיכוי חורג מהיתרה הניתנת לזיכוי', CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE);
  }
  if (message.includes(CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE)) {
    throw conflict('הזיכוי חורג מהכמות/סכום הנותרים בשורת המקור', CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE);
  }
  if (message.includes('CREDIT_LINEAGE_INCOMPLETE') || message.includes('CREDIT_CONTROL_MISSING')) {
    throw badRequest('Credit draft lineage is incomplete');
  }
  if (message.includes('CREDIT_LINK_ALREADY_ISSUED')) {
    throw conflict('Credit note already issued');
  }
  if (message.includes('CREDIT_CONSUME_ARGS_REQUIRED')) {
    throw badRequest(message);
  }
  throw new AppError(502, message, 'ACCOUNTING_BASE_CREDIT_CONSUME_RPC_FAILED', {
    pg_code: err.code,
  });
}

export async function callConsumeIncomeTaxInvoiceCreditRpc(input: {
  organizationId: string;
  draftId: string;
  issuedDocumentId: string;
  requestedAmount: number;
  lines: Array<{ source_line_identity: string; quantity: number; amount: number }>;
  createdBy: string;
}): Promise<AtomicCreditConsumeResult> {
  const { data, error } = await supabaseAdmin.rpc(ACCOUNTING_BASE_CONSUME_INCOME_TAX_INVOICE_CREDIT_RPC, {
    p_organization_id: input.organizationId,
    p_draft_id: input.draftId,
    p_issued_document_id: input.issuedDocumentId,
    p_requested_amount: input.requestedAmount,
    p_lines: input.lines,
    p_created_by: input.createdBy,
  });
  if (error) mapCreditConsumeRpcError(error);
  if (!data || typeof data !== 'object') {
    throw new AppError(502, 'Credit consume RPC returned empty result', 'ACCOUNTING_BASE_CREDIT_CONSUME_RPC_EMPTY');
  }
  const row = data as Record<string, unknown>;
  const sourceInvoiceId = String(row.source_invoice_id ?? '');
  if (!sourceInvoiceId) {
    throw new AppError(502, 'Credit consume RPC missing source invoice', 'ACCOUNTING_BASE_CREDIT_CONSUME_RPC_INVALID');
  }
  return {
    replay: Boolean(row.replay),
    source_invoice_id: sourceInvoiceId,
    credited_amount_reference: Number(row.credited_amount_reference ?? 0),
    remaining_creditable_amount: Number(row.remaining_creditable_amount ?? 0),
    remaining_receivable:
      row.remaining_receivable == null ? null : Number(row.remaining_receivable),
    customer_credit_amount: Number(row.customer_credit_amount ?? 0),
    customer_credit_id: row.customer_credit_id ? String(row.customer_credit_id) : null,
  };
}

export async function callReverseIncomeTaxInvoiceCreditConsumeRpc(input: {
  organizationId: string;
  draftId: string;
  issuedDocumentId: string;
  requestedAmount: number;
  lines: Array<{ source_line_identity: string; quantity: number; amount: number }>;
}): Promise<void> {
  const { error } = await supabaseAdmin.rpc(ACCOUNTING_BASE_REVERSE_INCOME_TAX_INVOICE_CREDIT_CONSUME_RPC, {
    p_organization_id: input.organizationId,
    p_draft_id: input.draftId,
    p_issued_document_id: input.issuedDocumentId,
    p_requested_amount: input.requestedAmount,
    p_lines: input.lines,
  });
  if (error) {
    throw new AppError(502, error.message, 'ACCOUNTING_BASE_CREDIT_REVERSE_RPC_FAILED', {
      pg_code: error.code,
    });
  }
}

export async function loadOpenCustomerCreditAmountByCustomer(
  orgId: string,
  incomeCustomerId: string | null,
): Promise<number> {
  if (!incomeCustomerId) return 0;
  const { data, error } = await supabaseAdmin
    .from('accounting_customer_credits')
    .select('amount')
    .eq('organization_id', orgId)
    .eq('income_customer_id', incomeCustomerId)
    .eq('status', 'open');
  throwIfSupabaseError(error, 'loadOpenCustomerCreditAmountByCustomer', {
    migrationHint: '162_accounting_base_customer_credit_and_atomic_credit_consume.sql',
  });
  return roundMoney2(
    ((data ?? []) as Array<{ amount: number }>).reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
  );
}

export async function loadOpenCustomerCreditsForInvoices(
  orgId: string,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const byInvoice = new Map<string, number>();
  for (const id of invoiceIds) byInvoice.set(id, 0);
  if (invoiceIds.length === 0) return byInvoice;
  const { data, error } = await supabaseAdmin
    .from('accounting_customer_credits')
    .select('source_invoice_id, amount')
    .eq('organization_id', orgId)
    .in('source_invoice_id', invoiceIds)
    .eq('status', 'open');
  throwIfSupabaseError(error, 'loadOpenCustomerCreditsForInvoices', {
    migrationHint: '162_accounting_base_customer_credit_and_atomic_credit_consume.sql',
  });
  for (const row of (data ?? []) as Array<{ source_invoice_id: string; amount: number }>) {
    byInvoice.set(row.source_invoice_id, roundMoney2((byInvoice.get(row.source_invoice_id) ?? 0) + Number(row.amount ?? 0)));
  }
  return byInvoice;
}

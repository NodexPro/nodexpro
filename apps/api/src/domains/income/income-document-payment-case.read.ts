/**
 * INV-5B/5C — income_document_payment_case aggregate (Income orchestration read model).
 * Financial amounts come from Accounting Base; lineage from income_document_links.
 * After payment command: includes full refreshed documents-list + invoices-tab truth
 * so the UI replaces state with zero post-command GETs.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { buildIncomeInvoicePaymentCaseAggregate } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { buildWorkEngineInvoicesClientDocumentsByTypeAggregate } from '../work-engine/work-engine-invoices-client-documents-by-type.read-model.service.js';
import {
  buildWorkEngineInvoicesTabAggregate,
  type WorkEngineInvoicesTabAggregate,
} from '../work-engine/work-engine-invoices-tab.read-model.service.js';
import { issueYearFromIso } from './income-client-income-ledger-card.pure.js';
import {
  INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE,
  INCOME_DOCUMENT_PAYMENT_CASE_KEY,
  INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
  resolvePaymentStateIcon,
  type IncomeDocumentRecordPaymentForm,
} from './income-document-payment.pure.js';
import type {
  WorkEngineInvoicesClientDocumentsByTypeAggregate,
  WorkEngineInvoicesClientDocumentsByTypeRow,
} from './income.types.js';

export type IncomeDocumentPaymentCaseLinkedReceipt = {
  document_id: string;
  document_number: string;
  document_type_key: 'receipt';
  document_type_label: 'קבלה';
  amount: number;
  payment_date: string;
  relationship_key: typeof INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE;
  relationship_label: string;
  payment_id: string;
  allocation_id: string;
};

export type IncomeDocumentPaymentCaseAggregate = {
  aggregate_key: typeof INCOME_DOCUMENT_PAYMENT_CASE_KEY;
  income_document_id: string;
  document_number: string;
  document_type: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  financial_summary: {
    original_amount: number;
    allocated_amount: number;
    remaining_balance: number;
    currency: string;
    payment_state_key: 'unpaid' | 'partial' | 'paid';
    payment_state_label: string;
    payment_state_tone: 'danger' | 'warning' | 'success';
    payment_state_icon: 'check' | null;
    financial_source: 'accounting_base';
  };
  payments: Array<{
    payment_id: string;
    allocation_id: string;
    payment_date: string;
    payment_method_key: string;
    payment_method_label: string;
    amount: number;
    currency: string;
    reference_number: string | null;
  }>;
  linked_receipts: IncomeDocumentPaymentCaseLinkedReceipt[];
  newly_issued_receipt: IncomeDocumentPaymentCaseLinkedReceipt | null;
  document_type_counters: {
    tax_invoice: number;
    receipt: number;
  };
  allowed_actions: Array<{
    action_key: string;
    label: string;
    enabled: boolean;
    command: string;
    reason: string | null;
  }>;
  /** Source tax-invoice row from refreshed documents-by-type list (INV-5C). */
  source_invoice_row: WorkEngineInvoicesClientDocumentsByTypeRow | null;
  /** Form state after payment (null when record_payment no longer allowed). */
  record_payment_form: IncomeDocumentRecordPaymentForm | null;
  /** Full refreshed documents list for the open modal (INV-5C — replace FE state). */
  work_engine_invoices_client_documents_by_type_aggregate: WorkEngineInvoicesClientDocumentsByTypeAggregate | null;
  /** Full refreshed invoices tab (counters / panel) — replace FE state, no follow-up GET. */
  work_engine_invoices_tab_aggregate: WorkEngineInvoicesTabAggregate;
};

export async function listPaymentReceiptLinksForInvoice(
  organizationId: string,
  invoiceDocumentId: string,
): Promise<IncomeDocumentPaymentCaseLinkedReceipt[]> {
  const { data, error } = await supabaseAdmin
    .from('income_document_links')
    .select(
      'target_document_id, payment_id, allocation_id, allocated_amount, currency, relationship_label, relationship_key, created_at',
    )
    .eq('organization_id', organizationId)
    .eq('source_document_id', invoiceDocumentId)
    .eq('relationship_key', INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE)
    .order('created_at', { ascending: true });
  throwIfSupabaseError(error, 'Failed to load income document links');

  const rows = (data ?? []) as Array<{
    target_document_id: string;
    payment_id: string;
    allocation_id: string;
    allocated_amount: number;
    currency: string;
    relationship_label: string;
  }>;
  if (rows.length === 0) return [];

  const receiptIds = rows.map((r) => r.target_document_id);
  const { data: docs, error: docErr } = await supabaseAdmin
    .from('income_documents')
    .select('id, document_number, issue_date')
    .eq('organization_id', organizationId)
    .in('id', receiptIds);
  throwIfSupabaseError(docErr, 'Failed to load linked receipts');

  const byId = new Map(
    ((docs ?? []) as Array<{ id: string; document_number: string; issue_date: string }>).map(
      (d) => [d.id, d],
    ),
  );

  const out: IncomeDocumentPaymentCaseLinkedReceipt[] = [];
  for (const r of rows) {
    const doc = byId.get(r.target_document_id);
    if (!doc) continue;
    out.push({
      document_id: r.target_document_id,
      document_number: doc.document_number,
      document_type_key: 'receipt',
      document_type_label: 'קבלה',
      amount: Number(r.allocated_amount),
      payment_date: doc.issue_date,
      relationship_key: INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE,
      relationship_label: r.relationship_label,
      payment_id: r.payment_id,
      allocation_id: r.allocation_id,
    });
  }
  return out;
}

async function countIssuedByType(
  organizationId: string,
  issuerBusinessId: string,
  representedClientId: string | null,
): Promise<{ tax_invoice: number; receipt: number }> {
  let q = supabaseAdmin
    .from('income_documents')
    .select('document_type')
    .eq('organization_id', organizationId)
    .eq('issuer_business_id', issuerBusinessId)
    .eq('document_status', 'issued')
    .in('document_type', ['tax_invoice', 'receipt']);
  if (representedClientId == null) {
    q = q.is('represented_client_id', null);
  } else {
    q = q.eq('represented_client_id', representedClientId);
  }
  const { data, error } = await q;
  throwIfSupabaseError(error, 'Failed to count income documents');
  let tax_invoice = 0;
  let receipt = 0;
  for (const row of data ?? []) {
    const t = String((row as { document_type: string }).document_type);
    if (t === 'tax_invoice') tax_invoice += 1;
    if (t === 'receipt') receipt += 1;
  }
  return { tax_invoice, receipt };
}

export async function buildIncomeDocumentPaymentCaseAggregate(
  ctx: RequestContext,
  organizationId: string,
  incomeDocumentId: string,
  opts?: {
    newlyIssuedReceiptId?: string | null;
    documentsListYear?: number | null;
  },
): Promise<IncomeDocumentPaymentCaseAggregate> {
  const docId = String(incomeDocumentId ?? '').trim();
  if (!docId) throw badRequest('income_document_id required');

  const abCase = await buildIncomeInvoicePaymentCaseAggregate(ctx, organizationId, docId);
  const linked = await listPaymentReceiptLinksForInvoice(organizationId, docId);
  const counters = await countIssuedByType(
    organizationId,
    abCase.issuer_business_id,
    abCase.represented_client_id,
  );

  const newly =
    opts?.newlyIssuedReceiptId != null
      ? linked.find((r) => r.document_id === opts.newlyIssuedReceiptId) ?? null
      : null;

  const canRecord = abCase.allowed_actions.some(
    (a) => a.action_key === 'record_payment' && a.enabled,
  );
  const recordReason =
    abCase.allowed_actions.find((a) => a.action_key === 'record_payment')?.reason ?? null;

  const { data: issueDateRow, error: issueDateErr } = await supabaseAdmin
    .from('income_documents')
    .select('issue_date')
    .eq('organization_id', organizationId)
    .eq('id', docId)
    .maybeSingle();
  throwIfSupabaseError(issueDateErr, 'Failed to load income document issue date');
  const issueYear = issueYearFromIso(
    String((issueDateRow as { issue_date?: string } | null)?.issue_date ?? ''),
  );
  const documentsListYear =
    opts?.documentsListYear != null && Number.isFinite(opts.documentsListYear)
      ? Number(opts.documentsListYear)
      : issueYear;

  let documentsByType: WorkEngineInvoicesClientDocumentsByTypeAggregate | null = null;
  let sourceInvoiceRow: WorkEngineInvoicesClientDocumentsByTypeRow | null = null;
  let recordPaymentForm: IncomeDocumentRecordPaymentForm | null = null;

  if (abCase.represented_client_id) {
    documentsByType = await buildWorkEngineInvoicesClientDocumentsByTypeAggregate({
      ctx,
      representedClientId: abCase.represented_client_id,
      documentTypeKey: 'tax_invoice',
      year: documentsListYear,
    });
    sourceInvoiceRow =
      documentsByType.rows.find((row) => row.document_id === docId) ?? null;
    recordPaymentForm = sourceInvoiceRow?.record_payment_form ?? null;
  }

  const invoicesTab = await buildWorkEngineInvoicesTabAggregate({ ctx });

  return {
    aggregate_key: INCOME_DOCUMENT_PAYMENT_CASE_KEY,
    income_document_id: abCase.income_document_id,
    document_number: abCase.document_number,
    document_type: abCase.document_type,
    issuer_business_id: abCase.issuer_business_id,
    represented_client_id: abCase.represented_client_id,
    financial_summary: {
      original_amount: abCase.original_amount,
      allocated_amount: abCase.allocated_amount,
      remaining_balance: abCase.remaining_balance,
      currency: abCase.currency,
      payment_state_key: abCase.payment_state_key,
      payment_state_label: abCase.payment_state_label,
      payment_state_tone: abCase.payment_state_tone,
      payment_state_icon: resolvePaymentStateIcon(abCase.payment_state_key),
      financial_source: 'accounting_base',
    },
    payments: abCase.payments.map((p) => ({
      payment_id: p.payment_id,
      allocation_id: p.allocation_id,
      payment_date: p.payment_date,
      payment_method_key: p.payment_method_key,
      payment_method_label: p.payment_method_label,
      amount: p.amount,
      currency: p.currency,
      reference_number: p.reference_number,
    })),
    linked_receipts: linked,
    newly_issued_receipt: newly,
    document_type_counters: counters,
    allowed_actions: [
      {
        action_key: 'record_payment',
        label: 'רישום תשלום',
        enabled: canRecord,
        command: INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
        reason: recordReason,
      },
    ],
    source_invoice_row: sourceInvoiceRow,
    record_payment_form: recordPaymentForm,
    work_engine_invoices_client_documents_by_type_aggregate: documentsByType,
    work_engine_invoices_tab_aggregate: invoicesTab,
  };
}
export async function assertIncomeDocumentExistsInOrg(
  organizationId: string,
  incomeDocumentId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('id', incomeDocumentId)
    .maybeSingle();
  throwIfSupabaseError(error, 'Failed to load income document');
  if (!data) throw notFound('Income document not found');
}

export function requireIncomeViewOrPaymentPerm(ctx: RequestContext): void {
  const perms = ctx.membership?.permissions ?? [];
  if (!perms.includes('income.view') && !perms.includes('accounting_base.payment.write')) {
    throw forbidden('income.view required');
  }
}

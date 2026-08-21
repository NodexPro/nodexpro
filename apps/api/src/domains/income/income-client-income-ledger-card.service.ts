/**
 * Income — Client income ledger card aggregate (כרטסת לקוח).
 * Document identity from Income; debit/credit/running balance from Accounting Base allocations.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  parseIncomePaymentMethodKey,
  resolveIncomeInvoiceOriginalAmount,
  type IncomeInvoicePaymentMethodKey,
} from '../accounting-base/accounting-base-income-payment.pure.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { isUuid } from './income.guards.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { buildIncomeIssuedDocumentViewAction } from './income-document-view-action.pure.js';
import { resolveIncomeDocumentDocflowSendEligibility } from './income-document-docflow-delivery.pure.js';
import {
  isDocflowEntitledForOrg,
  loadRepresentedClientDocflowPortalActive,
} from './income-document-email-delivery.read-model.service.js';
import {
  calendarDateIso,
  resolveIncomeDocumentSemanticDates,
} from './income-document-semantic-dates.pure.js';
import {
  buildLedgerInvoiceGroups,
  buildLedgerTransactionRows,
  formatLedgerMoneyReference,
  INCOME_LEDGER_FINANCIAL_SOURCE,
  incomeLedgerCashboxTypeLabel,
  issueYearFromIso,
  parseLedgerCalendarDate,
  type LedgerInvoiceGroupInput,
  type LedgerInvoicePaymentInput,
  type LedgerTransactionEventInput,
} from './income-client-income-ledger-card.pure.js';
import {
  loadIssuedCreditAmountsByInvoice,
  loadIssuedCreditRowsForInvoices,
} from './income-document-tax-invoice-credit.service.js';
import { composeCollectibleAfterCredit } from './income-document-tax-invoice-credit.pure.js';
import { loadOpenCustomerCreditAmountByCustomer } from '../accounting-base/accounting-base-customer-credit.service.js';
import {
  INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY,
  type IncomeActingMode,
  type IncomeClientIncomeLedgerCardAggregate,
  type IncomeClientIncomeLedgerCardDeliveryAction,
  type IncomeDocumentType,
} from './income.types.js';

const LEDGER_INVOICE_TYPES: IncomeDocumentType[] = ['tax_invoice'];

const DOCUMENT_TYPE_LABELS: Record<'tax_invoice', string> = {
  tax_invoice: 'חשבונית מס',
};

type RawDoc = {
  id: string;
  document_type: IncomeDocumentType;
  document_number: string;
  issue_date: string;
  due_date: string | null;
  created_at: string;
  currency: string;
  income_customer_id: string | null;
  document_status: string;
  pdf_render_status: string;
  pdf_asset_id: string | null;
  totals_snapshot_json: Record<string, unknown> | null;
};

type PostedAllocationRow = {
  id: string;
  payment_id: string;
  source_entity_id: string;
  allocated_amount: number;
};

type PostedPaymentRow = {
  id: string;
  payment_date: string;
  payment_method_key: string;
  currency: string;
};

type PaymentOperationRow = {
  payment_id: string | null;
  allocation_id: string | null;
  receipt_document_id: string | null;
};

type ReceiptDocRow = {
  id: string;
  document_number: string;
  represented_client_id: string | null;
};

type IncomeCustomerRow = {
  id: string;
  display_name: string;
  tax_id: string | null;
  email: string | null;
};

function assertLedgerAccess(ctx: RequestContext): void {
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.view) throw forbidden('income.view required');
  if (!perms.issue_on_behalf) throw forbidden('income.issue_on_behalf required');
}

function todayIso(): string {
  return calendarDateIso(new Date().toISOString()) ?? '1970-01-01';
}

function resolveLedgerPeriod(params: {
  fromDate?: string | null;
  toDate?: string | null;
  year?: number | null;
}): { from_date: string; to_date: string } {
  const from = parseLedgerCalendarDate(params.fromDate);
  const to = parseLedgerCalendarDate(params.toDate);
  if ((params.fromDate && !from) || (params.toDate && !to)) {
    throw badRequest('from_date / to_date must be YYYY-MM-DD');
  }
  if (from && to) {
    if (from > to) throw badRequest('from_date must be on or before to_date');
    return { from_date: from, to_date: to };
  }
  if (params.year != null && Number.isFinite(params.year)) {
    const year = Math.trunc(params.year);
    return { from_date: `${year}-01-01`, to_date: `${year}-12-31` };
  }
  const currentYear = new Date().getFullYear();
  return { from_date: `${currentYear}-01-01`, to_date: todayIso() };
}

async function loadRepresentedClient(orgId: string, clientId: string) {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id, email, is_archived')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadLedgerRepresentedClient');
  const row = data as
    | { id: string; display_name: string; tax_id: string | null; email: string | null; is_archived: boolean }
    | null;
  if (!row || row.is_archived) throw notFound('Office client not found');
  return row;
}

async function loadLedgerCreditDocuments(
  orgId: string,
  representedClientId: string,
  creditDocumentIds: string[],
): Promise<Map<string, { document_number: string; issue_date: string }>> {
  const byId = new Map<string, { document_number: string; issue_date: string }>();
  if (creditDocumentIds.length === 0) return byId;
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id, document_number, issue_date')
    .eq('organization_id', orgId)
    .eq('represented_client_id', representedClientId)
    .eq('document_type', 'credit_tax_invoice')
    .eq('document_status', 'issued')
    .in('id', creditDocumentIds);
  throwIfSupabaseError(error, 'loadLedgerCreditDocuments');
  for (const row of (data ?? []) as Array<{ id: string; document_number: string; issue_date: string }>) {
    byId.set(row.id, { document_number: row.document_number, issue_date: row.issue_date });
  }
  return byId;
}

async function loadLedgerInvoices(orgId: string, representedClientId: string): Promise<RawDoc[]> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, document_type, document_number, issue_date, due_date, created_at, currency, income_customer_id, document_status, pdf_render_status, pdf_asset_id, totals_snapshot_json',
    )
    .eq('organization_id', orgId)
    .eq('represented_client_id', representedClientId)
    .eq('document_status', 'issued')
    .in('document_type', LEDGER_INVOICE_TYPES)
    .order('issue_date', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(5000);
  throwIfSupabaseError(error, 'loadLedgerInvoices');
  return (data ?? []) as RawDoc[];
}

async function loadIncomeCustomersByIds(
  orgId: string,
  representedClientId: string,
  ids: string[],
): Promise<Map<string, IncomeCustomerRow>> {
  const byId = new Map<string, IncomeCustomerRow>();
  if (ids.length === 0) return byId;
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .select('id, display_name, tax_id, email')
    .eq('organization_id', orgId)
    .eq('issuer_business_id', representedClientId)
    .eq('represented_client_id', representedClientId)
    .in('id', ids);
  throwIfSupabaseError(error, 'loadLedgerIncomeCustomers');
  for (const row of (data ?? []) as IncomeCustomerRow[]) {
    byId.set(row.id, row);
  }
  return byId;
}

async function loadIncomeCustomer(
  orgId: string,
  representedClientId: string,
  incomeCustomerId: string,
): Promise<IncomeCustomerRow | null> {
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .select('id, display_name, tax_id, email')
    .eq('organization_id', orgId)
    .eq('issuer_business_id', representedClientId)
    .eq('represented_client_id', representedClientId)
    .eq('id', incomeCustomerId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadLedgerIncomeCustomer');
  return (data as IncomeCustomerRow | null) ?? null;
}

async function loadReceiptsByAllocation(
  orgId: string,
  representedClientId: string,
  allocationIds: string[],
): Promise<Map<string, { receipt_document_id: string; receipt_document_number: string }>> {
  const byAllocation = new Map<string, { receipt_document_id: string; receipt_document_number: string }>();
  if (allocationIds.length === 0) return byAllocation;

  const { data: opRows, error: opErr } = await supabaseAdmin
    .from('income_document_payment_operations')
    .select('payment_id, allocation_id, receipt_document_id')
    .eq('organization_id', orgId)
    .in('allocation_id', allocationIds)
    .eq('status', 'completed');
  throwIfSupabaseError(opErr, 'loadLedgerPaymentOperations');

  const operations = (opRows ?? []) as PaymentOperationRow[];
  const receiptIds = Array.from(
    new Set(operations.map((row) => row.receipt_document_id).filter((id): id is string => Boolean(id))),
  );
  if (receiptIds.length === 0) return byAllocation;

  const { data: receiptRows, error: receiptErr } = await supabaseAdmin
    .from('income_documents')
    .select('id, document_number, represented_client_id')
    .eq('organization_id', orgId)
    .eq('represented_client_id', representedClientId)
    .eq('document_status', 'issued')
    .in('id', receiptIds);
  throwIfSupabaseError(receiptErr, 'loadLedgerReceiptDocuments');

  const receiptsById = new Map<string, ReceiptDocRow>();
  for (const row of (receiptRows ?? []) as ReceiptDocRow[]) {
    receiptsById.set(row.id, row);
  }

  for (const operation of operations) {
    if (!operation.allocation_id || !operation.receipt_document_id) continue;
    const receipt = receiptsById.get(operation.receipt_document_id);
    if (!receipt) continue;
    byAllocation.set(operation.allocation_id, {
      receipt_document_id: receipt.id,
      receipt_document_number: receipt.document_number,
    });
  }
  return byAllocation;
}

async function loadPostedAllocationsByInvoice(
  orgId: string,
  representedClientId: string,
  invoiceIds: string[],
  canView: boolean,
): Promise<Map<string, LedgerInvoicePaymentInput[]>> {
  const byInvoice = new Map<string, LedgerInvoicePaymentInput[]>();
  for (const id of invoiceIds) byInvoice.set(id, []);
  if (invoiceIds.length === 0) return byInvoice;

  const { data: allocRows, error: allocErr } = await supabaseAdmin
    .from('accounting_payment_allocations')
    .select('id, payment_id, source_entity_id, allocated_amount')
    .eq('organization_id', orgId)
    .eq('source_module', 'income')
    .in('source_entity_id', invoiceIds)
    .eq('status', 'posted')
    .is('reversal_of_allocation_id', null)
    .order('created_at', { ascending: true });
  throwIfSupabaseError(allocErr, 'loadLedgerPostedAllocations');

  const allocations = (allocRows ?? []) as PostedAllocationRow[];
  const paymentIds = Array.from(new Set(allocations.map((row) => row.payment_id).filter(Boolean)));
  const paymentsById = new Map<string, PostedPaymentRow>();
  if (paymentIds.length > 0) {
    const { data: payRows, error: payErr } = await supabaseAdmin
      .from('accounting_payments')
      .select('id, payment_date, payment_method_key, currency')
      .eq('organization_id', orgId)
      .in('id', paymentIds);
    throwIfSupabaseError(payErr, 'loadLedgerPostedPayments');
    for (const row of (payRows ?? []) as PostedPaymentRow[]) {
      paymentsById.set(row.id, row);
    }
  }

  const receiptsByAllocation = await loadReceiptsByAllocation(
    orgId,
    representedClientId,
    allocations.map((row) => row.id),
  );

  for (const allocation of allocations) {
    const payment = paymentsById.get(allocation.payment_id);
    if (!payment) continue;
    let methodKey: IncomeInvoicePaymentMethodKey;
    try {
      methodKey = parseIncomePaymentMethodKey(payment.payment_method_key);
    } catch {
      methodKey = 'other';
    }
    const amount = Number(allocation.allocated_amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const receipt = receiptsByAllocation.get(allocation.id) ?? null;
    const list = byInvoice.get(allocation.source_entity_id) ?? [];
    list.push({
      payment_id: payment.id,
      allocation_id: allocation.id,
      cashbox_display: incomeLedgerCashboxTypeLabel(methodKey),
      payment_date: payment.payment_date,
      amount,
      currency: payment.currency || 'ILS',
      receipt_document_id: receipt?.receipt_document_id ?? null,
      receipt_document_number: receipt?.receipt_document_number ?? null,
      view_action: buildIncomeIssuedDocumentViewAction({
        incomeDocumentId: receipt?.receipt_document_id ?? '',
        canView: Boolean(receipt) && canView,
        disabledReason: receipt ? null : 'אין קבלה שהונפקה לתשלום זה',
      }),
    });
    byInvoice.set(allocation.source_entity_id, list);
  }

  return byInvoice;
}

function invoiceTransactionDate(doc: RawDoc): string {
  const semantic = resolveIncomeDocumentSemanticDates({
    issue_date: doc.issue_date,
    due_date: doc.due_date,
  });
  return semantic.document_date ?? calendarDateIso(doc.issue_date) ?? todayIso();
}

function paymentTransactionDate(iso: string): string {
  return calendarDateIso(iso) ?? todayIso();
}

function resolveAvailableYears(docs: RawDoc[]): number[] {
  const years = new Set<number>();
  for (const doc of docs) {
    const y = issueYearFromIso(invoiceTransactionDate(doc));
    if (y != null) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

function buildDeliveryActions(params: {
  latestInvoice: RawDoc | null;
  permissions: ReturnType<typeof incomeWorkspacePermissionsFromContext>;
  representedClientId: string;
  docflowEntitled: boolean;
  portalActive: boolean;
}): IncomeClientIncomeLedgerCardDeliveryAction[] {
  const latest = params.latestInvoice;
  if (!latest) {
    return [
      {
        key: 'send_by_email',
        label: 'שליחה במייל',
        icon_key: 'email',
        enabled: false,
        disabled_reason: 'אין חשבונית שהונפקה לשליחה',
        income_document_id: null,
        open_action_key: 'open_email_history',
      },
      {
        key: 'send_by_docflow',
        label: 'שליחה ב-DocFlow',
        icon_key: 'docflow',
        enabled: false,
        disabled_reason: 'אין חשבונית שהונפקה לשליחה',
        income_document_id: null,
        open_action_key: 'open_docflow_send',
      },
    ];
  }

  const canOpen = params.permissions.view;
  const docflow = resolveIncomeDocumentDocflowSendEligibility({
    permissions: params.permissions,
    representedClientId: params.representedClientId,
    documentStatus: latest.document_status,
    pdfRenderStatus: latest.pdf_render_status,
    pdfAssetId: latest.pdf_asset_id,
    docflowEntitled: params.docflowEntitled,
    portalActive: params.portalActive,
  });

  return [
    {
      key: 'send_by_email',
      label: 'שליחה במייל',
      icon_key: 'email',
      enabled: canOpen,
      disabled_reason: canOpen ? null : 'אין הרשאת צפייה',
      income_document_id: latest.id,
      open_action_key: 'open_email_history',
    },
    {
      key: 'send_by_docflow',
      label: 'שליחה ב-DocFlow',
      icon_key: 'docflow',
      enabled: canOpen && params.docflowEntitled && params.portalActive,
      disabled_reason:
        !canOpen
          ? 'אין הרשאת צפייה'
          : docflow.enabled
            ? null
            : docflow.disabled_reason,
      income_document_id: latest.id,
      open_action_key: 'open_docflow_send',
    },
  ];
}

export async function buildIncomeClientIncomeLedgerCardAggregate(params: {
  ctx: RequestContext;
  representedClientId: string;
  endCustomerId?: string | null;
  year?: number | null;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<IncomeClientIncomeLedgerCardAggregate> {
  const orgId = params.ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');

  assertLedgerAccess(params.ctx);
  const perms = incomeWorkspacePermissionsFromContext(params.ctx);

  const representedClientId = String(params.representedClientId ?? '').trim();
  if (!representedClientId) throw badRequest('represented_client_id is required');
  if (!isUuid(representedClientId)) throw badRequest('represented_client_id must be a valid UUID');

  const requestedEndCustomerId = String(params.endCustomerId ?? '').trim();
  if (requestedEndCustomerId && !isUuid(requestedEndCustomerId)) {
    throw badRequest('end_customer_id must be a valid UUID');
  }

  const period = resolveLedgerPeriod({
    fromDate: params.fromDate ?? null,
    toDate: params.toDate ?? null,
    year: params.year ?? null,
  });

  const client = await loadRepresentedClient(orgId, representedClientId);
  const allDocs = await loadLedgerInvoices(orgId, representedClientId);

  const customerIds = Array.from(
    new Set(allDocs.map((doc) => doc.income_customer_id).filter((id): id is string => Boolean(id))),
  );
  const customersById = await loadIncomeCustomersByIds(orgId, representedClientId, customerIds);

  let selectedCustomer: IncomeCustomerRow | null = null;
  if (requestedEndCustomerId) {
    selectedCustomer =
      customersById.get(requestedEndCustomerId) ??
      (await loadIncomeCustomer(orgId, representedClientId, requestedEndCustomerId));
    if (!selectedCustomer) throw notFound('Income customer not found');
  } else if (customerIds.length === 1) {
    selectedCustomer = customersById.get(customerIds[0]!) ?? null;
  }

  const selectedEndCustomerId = selectedCustomer?.id ?? null;
  const customerDocs = selectedEndCustomerId
    ? allDocs.filter((doc) => doc.income_customer_id === selectedEndCustomerId)
    : [];

  const invoiceIds = customerDocs.map((d) => d.id);
  const [allocatedByInvoice, paymentsByInvoice, creditedByInvoice, creditRows, customerCreditAmount, docflowEntitled, portalActive] =
    await Promise.all([
      sumPostedAllocationsForIncomeDocuments(orgId, invoiceIds),
      loadPostedAllocationsByInvoice(orgId, representedClientId, invoiceIds, perms.view),
      loadIssuedCreditAmountsByInvoice(orgId, invoiceIds),
      loadIssuedCreditRowsForInvoices(orgId, invoiceIds),
      loadOpenCustomerCreditAmountByCustomer(orgId, selectedEndCustomerId),
      isDocflowEntitledForOrg(orgId),
      loadRepresentedClientDocflowPortalActive(orgId, representedClientId),
    ]);
  const creditDocs = await loadLedgerCreditDocuments(
    orgId,
    representedClientId,
    creditRows.map((row) => row.credit_document_id),
  );

  const invoiceInputs: LedgerInvoiceGroupInput[] = customerDocs.map((doc) => {
    const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
    const allocated = allocatedByInvoice.get(doc.id) ?? 0;
    const credited = creditedByInvoice.get(doc.id) ?? 0;
    const collectible = composeCollectibleAfterCredit({
      originalAmount: original,
      creditedAmount: credited,
      allocatedPayments: allocated,
    });
    return {
      income_document_id: doc.id,
      document_type_label: DOCUMENT_TYPE_LABELS.tax_invoice,
      document_number: doc.document_number,
      issue_date: invoiceTransactionDate(doc),
      original_amount: original,
      remaining_balance: collectible.remaining_receivable,
      currency: doc.currency || 'ILS',
      view_action: buildIncomeIssuedDocumentViewAction({
        incomeDocumentId: doc.id,
        canView: perms.view,
      }),
      payments: paymentsByInvoice.get(doc.id) ?? [],
    };
  });

  const events: LedgerTransactionEventInput[] = [];
  for (const invoice of invoiceInputs) {
    events.push({
      transaction_id: invoice.income_document_id,
      row_kind: 'invoice',
      transaction_date: invoice.issue_date,
      transaction_type_key: 'tax_invoice',
      transaction_type_label: invoice.document_type_label,
      document_id: invoice.income_document_id,
      document_number: invoice.document_number,
      source_document_id: null,
      source_document_number: null,
      payment_document_id: null,
      payment_document_number: null,
      debit_amount: invoice.original_amount,
      credit_amount: null,
      view_action: invoice.view_action,
    });
    for (const payment of invoice.payments) {
      events.push({
        transaction_id: payment.allocation_id,
        row_kind: 'payment',
        transaction_date: paymentTransactionDate(payment.payment_date),
        transaction_type_key: 'cashbox',
        transaction_type_label: payment.cashbox_display,
        document_id: null,
        document_number: null,
        source_document_id: invoice.income_document_id,
        source_document_number: invoice.document_number,
        payment_document_id: payment.receipt_document_id,
        payment_document_number: payment.receipt_document_number,
        debit_amount: null,
        credit_amount: payment.amount,
        view_action: payment.view_action,
      });
    }
    for (const credit of creditRows.filter((row) => row.source_invoice_id === invoice.income_document_id)) {
      const amount = Number(credit.credited_amount_reference ?? 0);
      if (!(amount > 0)) continue;
      const creditDoc = creditDocs.get(credit.credit_document_id);
      events.push({
        transaction_id: credit.credit_document_id,
        row_kind: 'credit_note',
        transaction_date: creditDoc?.issue_date ?? invoice.issue_date,
        transaction_type_key: 'credit_tax_invoice',
        transaction_type_label: 'חשבונית מס זיכוי',
        document_id: credit.credit_document_id,
        document_number: creditDoc?.document_number ?? null,
        source_document_id: invoice.income_document_id,
        source_document_number: invoice.document_number,
        payment_document_id: null,
        payment_document_number: null,
        debit_amount: null,
        credit_amount: amount,
        view_action: buildIncomeIssuedDocumentViewAction({
          incomeDocumentId: credit.credit_document_id,
          canView: perms.view,
        }),
      });
    }
  }

  const currency = customerDocs[0]?.currency ?? 'ILS';
  const ledger = buildLedgerTransactionRows({
    events,
    currency,
    fromDate: period.from_date,
    toDate: period.to_date,
  });
  const documents = buildLedgerInvoiceGroups(invoiceInputs);
  const availableYears = resolveAvailableYears(allDocs);
  const selectedYear = issueYearFromIso(period.from_date) ?? new Date().getFullYear();

  const latestInvoice =
    [...customerDocs].sort((a, b) => {
      const dateCmp = invoiceTransactionDate(a).localeCompare(invoiceTransactionDate(b));
      if (dateCmp !== 0) return dateCmp;
      return a.document_number.localeCompare(b.document_number, 'he', { numeric: true });
    }).at(-1) ?? null;

  const delivery_actions = selectedEndCustomerId
    ? buildDeliveryActions({
        latestInvoice,
        permissions: perms,
        representedClientId,
        docflowEntitled,
        portalActive,
      })
    : [
        {
          key: 'send_by_email' as const,
          label: 'שליחה במייל',
          icon_key: 'email' as const,
          enabled: false,
          disabled_reason: 'בחרו לקוח לשליחה',
          income_document_id: null,
          open_action_key: 'open_email_history' as const,
        },
        {
          key: 'send_by_docflow' as const,
          label: 'שליחה ב-DocFlow',
          icon_key: 'docflow' as const,
          enabled: false,
          disabled_reason: 'בחרו לקוח לשליחה',
          income_document_id: null,
          open_action_key: 'open_docflow_send' as const,
        },
      ];

  const actingMode: IncomeActingMode = 'office_representative';
  const showCustomerPicker = !selectedEndCustomerId || customersById.size > 1;
  const emptyBecauseNoCustomer = !selectedEndCustomerId;

  return {
    aggregate_key: INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY,
    financial_source: INCOME_LEDGER_FINANCIAL_SOURCE,
    title: 'כרטסת לקוח',
    ledger_customer: {
      id: selectedCustomer?.id ?? null,
      display_name: selectedCustomer?.display_name ?? '',
      tax_id: selectedCustomer?.tax_id ?? null,
      tax_id_label: 'ח.פ / ע.מ',
    },
    issuer_context: {
      issuer_business_id: representedClientId,
      display_name: client.display_name,
      represented_client_id: representedClientId,
      acting_mode: actingMode,
      label: 'עבור העסק',
    },
    period: {
      from_date: period.from_date,
      to_date: period.to_date,
      from_label: 'מתאריך',
      to_label: 'עד תאריך',
    },
    represented_client_id: representedClientId,
    represented_client_display_name: client.display_name,
    selected_end_customer_id: selectedEndCustomerId,
    selected_end_customer_display_name: selectedCustomer?.display_name ?? null,
    selected_year: selectedYear,
    available_years: availableYears.length > 0 ? availableYears : [selectedYear],
    end_customer_options: [...customersById.values()]
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'he'))
      .map((row) => ({
        end_customer_id: row.id,
        display_name: row.display_name,
        tax_id: row.tax_id,
        email: row.email,
        open_balance_display: '',
        open_balance_reference: 0,
        open_invoice_count: allDocs.filter((doc) => doc.income_customer_id === row.id).length,
        currency,
      })),
    show_customer_picker: showCustomerPicker,
    customer_picker_label: 'לקוח',
    customer_picker_placeholder: 'בחרו לקוח',
    user_notice: null,
    summary: {
      total_debit_display: formatLedgerMoneyReference(ledger.total_debit, currency),
      total_credit_display: formatLedgerMoneyReference(ledger.total_credit, currency),
      open_balance_display: formatLedgerMoneyReference(ledger.current_balance, currency),
      invoice_count: invoiceInputs.length,
      payment_count: invoiceInputs.reduce((n, inv) => n + inv.payments.length, 0),
      currency,
    },
    totals: {
      total_debit_display: formatLedgerMoneyReference(ledger.total_debit, currency),
      total_credit_display: formatLedgerMoneyReference(ledger.total_credit, currency),
      current_balance_display: formatLedgerMoneyReference(ledger.current_balance, currency),
      total_debit_label: 'סה״כ חובה',
      total_credit_label: 'סה״כ זכות',
      current_balance_label: 'יתרה נוכחית',
    },
    customer_credit: {
      visible: customerCreditAmount > 0.005,
      label: 'יתרת זכות ללקוח',
      amount_display: formatLedgerMoneyReference(customerCreditAmount, currency),
      amount_reference: customerCreditAmount,
      status_label: 'פתוחה — ללא החזר אוטומטי',
      financial_source: 'accounting_base',
    },
    table_columns: [
      { key: 'transaction_date_display', label: 'תאריך' },
      { key: 'transaction_type_label', label: 'סוג מסמך' },
      { key: 'document_number', label: "מס' מסמך" },
      { key: 'payment_document_number', label: "מס' תשלום / קבלה" },
      { key: 'debit_amount_display', label: 'חובה' },
      { key: 'credit_amount_display', label: 'זכות' },
      { key: 'running_balance_display', label: 'יתרה' },
      { key: 'view', label: 'צפייה' },
    ],
    documents,
    rows: ledger.rows,
    allowed_actions: ['open_document', 'open_email_history', 'open_docflow_send'],
    delivery_actions,
    top_actions: [
      {
        key: 'print_ledger',
        label: 'הדפסה',
        icon_key: 'print',
        enabled: true,
        disabled_reason: null,
        income_document_id: null,
        open_action_key: null,
      },
    ],
    empty_state: {
      visible: emptyBecauseNoCustomer || ledger.rows.length === 0,
      title: emptyBecauseNoCustomer ? 'בחרו לקוח להצגת הכרטסת' : 'אין תנועות בטווח התאריכים',
      description: null,
    },
    document_download_path_template: '/api/v1/income/documents/{document_id}/download',
  };
}

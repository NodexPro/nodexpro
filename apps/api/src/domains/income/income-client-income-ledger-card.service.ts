/**
 * Income — Client income ledger card aggregate (כרטסת).
 * TEMPORARY_ACCOUNTING_BASE_PENDING until Accounting Base AR ledger is available.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import {
  computeLedgerMovementRows,
  formatLedgerCreditDisplay,
  formatLedgerMoneyReference,
  INCOME_LEDGER_FINANCIAL_SOURCE,
  issueYearFromIso,
  ledgerAmountFromTotalsSnapshot,
  sumLedgerDebitCredit,
  type IncomeLedgerMovementInput,
} from './income-client-income-ledger-card.pure.js';
import {
  INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY,
  type IncomeClientIncomeLedgerCardAggregate,
  type IncomeClientIncomeLedgerCardEndCustomerOption,
  type IncomeDocumentType,
} from './income.types.js';

const LEDGER_DOCUMENT_TYPES: IncomeDocumentType[] = [
  'tax_invoice',
  'tax_invoice_receipt',
  'receipt',
  'credit_tax_invoice',
];

const TAX_INVOICE_TYPES = new Set<IncomeDocumentType>(['tax_invoice', 'tax_invoice_receipt']);

type RawDoc = {
  id: string;
  income_customer_id: string | null;
  document_type: IncomeDocumentType;
  document_number: string;
  issue_date: string;
  created_at: string;
  currency: string;
  totals_snapshot_json: Record<string, unknown> | null;
  customer_snapshot_json: Record<string, unknown> | null;
  pdf_render_status: string;
  pdf_asset_id: string | null;
};

function customerKeyFromDoc(doc: RawDoc): string | null {
  if (doc.income_customer_id) return doc.income_customer_id;
  const name = doc.customer_snapshot_json?.display_name;
  if (name != null && String(name).trim()) {
    return `snapshot:${String(name).trim().toLowerCase()}`;
  }
  return null;
}

function customerDisplayFromDoc(doc: RawDoc): string {
  const snap = doc.customer_snapshot_json?.display_name;
  if (snap != null && String(snap).trim()) return String(snap).trim();
  return '—';
}

function movementsFromDocument(doc: RawDoc): IncomeLedgerMovementInput[] {
  const amount = ledgerAmountFromTotalsSnapshot(doc.totals_snapshot_json);
  if (amount <= 0) return [];
  const canView = doc.pdf_render_status === 'rendered' && Boolean(doc.pdf_asset_id);
  const base = {
    document_number: doc.document_number,
    issue_date: doc.issue_date,
    created_at: doc.created_at,
    document_id: doc.id,
    can_view_document: canView,
  };

  if (doc.document_type === 'tax_invoice') {
    return [
      {
        row_id: `${doc.id}:invoice`,
        movement_type: 'invoice',
        income_label: 'חשבונית מס',
        debit_reference: amount,
        credit_reference: null,
        ...base,
      },
    ];
  }

  if (doc.document_type === 'tax_invoice_receipt') {
    return [
      {
        row_id: `${doc.id}:invoice`,
        movement_type: 'invoice',
        income_label: 'חשבונית מס',
        debit_reference: amount,
        credit_reference: null,
        ...base,
      },
      {
        row_id: `${doc.id}:payment`,
        movement_type: 'payment',
        income_label: 'תשלום',
        debit_reference: null,
        credit_reference: amount,
        document_number: doc.document_number,
        issue_date: doc.issue_date,
        created_at: `${doc.created_at}:pay`,
        document_id: doc.id,
        can_view_document: canView,
      },
    ];
  }

  if (doc.document_type === 'receipt') {
    return [
      {
        row_id: `${doc.id}:payment`,
        movement_type: 'payment',
        income_label: 'תשלום',
        debit_reference: null,
        credit_reference: amount,
        ...base,
      },
    ];
  }

  if (doc.document_type === 'credit_tax_invoice') {
    return [
      {
        row_id: `${doc.id}:credit`,
        movement_type: 'credit',
        income_label: 'זיכוי',
        debit_reference: null,
        credit_reference: amount,
        ...base,
      },
    ];
  }

  return [];
}

function assertLedgerAccess(ctx: RequestContext): void {
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.view) throw forbidden('income.view required');
  if (!perms.issue_on_behalf) throw forbidden('income.issue_on_behalf required');
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

async function loadLedgerDocuments(orgId: string, representedClientId: string): Promise<RawDoc[]> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, income_customer_id, document_type, document_number, issue_date, created_at, currency, totals_snapshot_json, customer_snapshot_json, pdf_render_status, pdf_asset_id',
    )
    .eq('organization_id', orgId)
    .eq('represented_client_id', representedClientId)
    .eq('document_status', 'issued')
    .in('document_type', LEDGER_DOCUMENT_TYPES)
    .order('issue_date', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(5000);
  throwIfSupabaseError(error, 'loadLedgerDocuments');
  return (data ?? []) as RawDoc[];
}

async function loadIncomeCustomersMeta(
  orgId: string,
  representedClientId: string,
  customerIds: string[],
): Promise<Map<string, { display_name: string; tax_id: string | null; email: string | null }>> {
  const map = new Map<string, { display_name: string; tax_id: string | null; email: string | null }>();
  if (customerIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .select('id, display_name, tax_id, email')
    .eq('organization_id', orgId)
    .eq('represented_client_id', representedClientId)
    .in('id', customerIds);
  throwIfSupabaseError(error, 'loadLedgerIncomeCustomers');
  for (const raw of data ?? []) {
    const row = raw as { id: string; display_name: string; tax_id: string | null; email: string | null };
    map.set(row.id, {
      display_name: row.display_name,
      tax_id: row.tax_id,
      email: row.email,
    });
  }
  return map;
}

function buildEndCustomerOptions(params: {
  docs: RawDoc[];
  customerMeta: Map<string, { display_name: string; tax_id: string | null; email: string | null }>;
}): IncomeClientIncomeLedgerCardEndCustomerOption[] {
  const byCustomer = new Map<string, { docs: RawDoc[]; hasTaxInvoice: boolean }>();

  for (const doc of params.docs) {
    const key = customerKeyFromDoc(doc);
    if (!key) continue;
    let bucket = byCustomer.get(key);
    if (!bucket) {
      bucket = { docs: [], hasTaxInvoice: false };
      byCustomer.set(key, bucket);
    }
    bucket.docs.push(doc);
    if (TAX_INVOICE_TYPES.has(doc.document_type)) bucket.hasTaxInvoice = true;
  }

  const options: IncomeClientIncomeLedgerCardEndCustomerOption[] = [];

  for (const [customerId, bucket] of byCustomer) {
    if (!bucket.hasTaxInvoice) continue;
    const movements = bucket.docs.flatMap(movementsFromDocument);
    const { open_balance_reference, total_debit_reference, total_credit_reference } =
      sumLedgerDebitCredit(movements);
    if (open_balance_reference <= 0.005) continue;

    const meta = params.customerMeta.get(customerId);
    const sampleDoc = bucket.docs[0]!;
    const currency = sampleDoc.currency || 'ILS';
    const display_name =
      meta?.display_name ??
      customerDisplayFromDoc(sampleDoc);
    const openInvoiceCount = bucket.docs.filter((d) => TAX_INVOICE_TYPES.has(d.document_type)).length;

    options.push({
      end_customer_id: customerId,
      display_name,
      tax_id: meta?.tax_id ?? null,
      email: meta?.email ?? null,
      open_balance_display: formatLedgerMoneyReference(open_balance_reference, currency),
      open_balance_reference,
      open_invoice_count: openInvoiceCount,
      currency,
    });
  }

  return options.sort((a, b) => a.display_name.localeCompare(b.display_name, 'he'));
}

function resolveAvailableYears(docs: RawDoc[], customerKey: string | null): number[] {
  const years = new Set<number>();
  for (const doc of docs) {
    if (customerKey && customerKeyFromDoc(doc) !== customerKey) continue;
    const y = issueYearFromIso(doc.issue_date);
    if (y != null) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

function resolveSelectedYear(
  availableYears: number[],
  requestedYear: number | null,
): number {
  const currentYear = new Date().getFullYear();
  if (requestedYear != null && availableYears.includes(requestedYear)) return requestedYear;
  if (availableYears.includes(currentYear)) return currentYear;
  return availableYears[0] ?? currentYear;
}

export async function buildIncomeClientIncomeLedgerCardAggregate(params: {
  ctx: RequestContext;
  representedClientId: string;
  endCustomerId?: string | null;
  year?: number | null;
}): Promise<IncomeClientIncomeLedgerCardAggregate> {
  const orgId = params.ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');

  assertLedgerAccess(params.ctx);

  const representedClientId = String(params.representedClientId ?? '').trim();
  if (!representedClientId) throw badRequest('represented_client_id is required');

  const client = await loadRepresentedClient(orgId, representedClientId);
  const docs = await loadLedgerDocuments(orgId, representedClientId);

  const incomeCustomerIds = [
    ...new Set(
      docs.map((d) => d.income_customer_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  const customerMeta = await loadIncomeCustomersMeta(orgId, representedClientId, incomeCustomerIds);
  const endCustomerOptions = buildEndCustomerOptions({ docs, customerMeta });

  let selectedEndCustomerId = params.endCustomerId?.trim() || null;
  if (!selectedEndCustomerId && endCustomerOptions.length === 1) {
    selectedEndCustomerId = endCustomerOptions[0]!.end_customer_id;
  }
  if (
    selectedEndCustomerId &&
    !endCustomerOptions.some((o) => o.end_customer_id === selectedEndCustomerId)
  ) {
    throw badRequest('end_customer_id is not eligible for ledger card');
  }

  const customerDocs = selectedEndCustomerId
    ? docs.filter((d) => customerKeyFromDoc(d) === selectedEndCustomerId)
    : [];

  const availableYears = resolveAvailableYears(customerDocs, selectedEndCustomerId);
  const selectedYear = selectedEndCustomerId
    ? resolveSelectedYear(availableYears, params.year ?? null)
    : new Date().getFullYear();

  const yearDocs = selectedEndCustomerId
    ? customerDocs.filter((d) => issueYearFromIso(d.issue_date) === selectedYear)
    : [];

  const movements = yearDocs.flatMap(movementsFromDocument);
  const currency = yearDocs[0]?.currency ?? customerDocs[0]?.currency ?? 'ILS';
  const rows = computeLedgerMovementRows({ movements, currency });
  const totals = sumLedgerDebitCredit(movements);
  const paymentCount = movements.filter((m) => m.movement_type === 'payment').length;
  const invoiceCount = movements.filter((m) => m.movement_type === 'invoice').length;

  const selectedOption = endCustomerOptions.find((o) => o.end_customer_id === selectedEndCustomerId);

  return {
    aggregate_key: INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY,
    financial_source: INCOME_LEDGER_FINANCIAL_SOURCE,
    represented_client_id: representedClientId,
    represented_client_display_name: client.display_name,
    selected_end_customer_id: selectedEndCustomerId,
    selected_end_customer_display_name: selectedOption?.display_name ?? null,
    selected_year: selectedYear,
    available_years: availableYears.length > 0 ? availableYears : [selectedYear],
    end_customer_options: endCustomerOptions,
    show_customer_picker: Boolean(!selectedEndCustomerId && endCustomerOptions.length > 1),
    summary: {
      total_debit_display: formatLedgerMoneyReference(totals.total_debit_reference, currency),
      total_credit_display: formatLedgerCreditDisplay(totals.total_credit_reference, currency),
      open_balance_display: formatLedgerMoneyReference(
        Math.max(0, totals.open_balance_reference),
        currency,
      ),
      invoice_count: invoiceCount,
      payment_count: paymentCount,
      currency,
    },
    table_columns: [
      { key: 'income_label', label: 'הכנסה' },
      { key: 'debit_amount_display', label: 'חובה' },
      { key: 'credit_amount_display', label: 'זכות' },
      { key: 'balance_display', label: 'יתרה' },
      { key: 'document_number', label: 'מס חש' },
      { key: 'issue_date_display', label: 'תאריך הפקה' },
      { key: 'view', label: 'צפייה' },
    ],
    rows,
    allowed_actions: ['view_income_document_pdf'],
    top_actions: [
      {
        key: 'send_ledger',
        label: 'שליחה',
        icon_key: 'send',
        enabled: false,
        disabled_reason: 'בקרוב',
      },
      {
        key: 'print_ledger',
        label: 'הדפסה',
        icon_key: 'print',
        enabled: true,
        disabled_reason: null,
      },
    ],
    empty_state: {
      visible:
        endCustomerOptions.length === 0 ||
        (Boolean(selectedEndCustomerId) && rows.length === 0),
      title:
        endCustomerOptions.length === 0
          ? 'אין לקוחות עם יתרה פתוחה'
          : 'אין תנועות לשנה שנבחרה',
      description:
        endCustomerOptions.length === 0
          ? 'כרטסת מציגה לקוחות קצה עם חשבוניות מס שלא שולמו במלואן.'
          : null,
    },
    document_download_path_template: '/api/v1/income/documents/{document_id}/download',
  };
}

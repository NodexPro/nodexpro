/**
 * Income — Client income ledger card aggregate (כרטסת).
 * TEMPORARY_ACCOUNTING_BASE_PENDING until Accounting Base AR ledger is available.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { buildLedgerEndCustomerOptions, computeLedgerMovementRows, formatLedgerCreditDisplay, formatLedgerMoneyReference, INCOME_LEDGER_FINANCIAL_SOURCE, issueYearFromIso, ledgerAmountFromTotalsSnapshot, sumLedgerDebitCredit, } from './income-client-income-ledger-card.pure.js';
import { INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY, } from './income.types.js';
const LEDGER_DOCUMENT_TYPES = [
    'tax_invoice',
    'tax_invoice_receipt',
    'receipt',
    'credit_tax_invoice',
];
const TAX_INVOICE_TYPES = new Set(['tax_invoice', 'tax_invoice_receipt']);
function movementsFromDocument(doc) {
    const amount = ledgerAmountFromTotalsSnapshot(doc.totals_snapshot_json);
    if (amount <= 0)
        return [];
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
function assertLedgerAccess(ctx) {
    const perms = incomeWorkspacePermissionsFromContext(ctx);
    if (!perms.view)
        throw forbidden('income.view required');
    if (!perms.issue_on_behalf)
        throw forbidden('income.issue_on_behalf required');
}
async function loadRepresentedClient(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, tax_id, email, is_archived')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadLedgerRepresentedClient');
    const row = data;
    if (!row || row.is_archived)
        throw notFound('Office client not found');
    return row;
}
async function loadLedgerDocuments(orgId, representedClientId) {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, income_customer_id, document_type, document_number, issue_date, created_at, currency, totals_snapshot_json, customer_snapshot_json, pdf_render_status, pdf_asset_id')
        .eq('organization_id', orgId)
        .eq('represented_client_id', representedClientId)
        .eq('document_status', 'issued')
        .in('document_type', LEDGER_DOCUMENT_TYPES)
        .order('issue_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(5000);
    throwIfSupabaseError(error, 'loadLedgerDocuments');
    return (data ?? []);
}
async function loadAllIncomeCustomersForRepresentedClient(orgId, representedClientId) {
    const { data, error } = await supabaseAdmin
        .from('income_customers')
        .select('id, display_name, tax_id, email')
        .eq('organization_id', orgId)
        .eq('represented_client_id', representedClientId)
        .eq('status', 'active')
        .order('display_name', { ascending: true })
        .limit(5000);
    throwIfSupabaseError(error, 'loadAllIncomeCustomersForRepresentedClient');
    return (data ?? []).map((raw) => {
        const row = raw;
        return {
            id: row.id,
            display_name: row.display_name,
            tax_id: row.tax_id,
            email: row.email,
        };
    });
}
async function assertEndCustomerBelongsToRepresentedClient(params) {
    const { data, error } = await supabaseAdmin
        .from('income_customers')
        .select('id, display_name, status')
        .eq('organization_id', params.orgId)
        .eq('represented_client_id', params.representedClientId)
        .eq('id', params.endCustomerId)
        .maybeSingle();
    throwIfSupabaseError(error, 'assertEndCustomerBelongsToRepresentedClient');
    const row = data;
    if (!row || row.status !== 'active') {
        throw badRequest('end_customer_id is not eligible for ledger card');
    }
    return { display_name: row.display_name };
}
function buildDocStatsByCustomerId(docs) {
    const byCustomer = new Map();
    for (const doc of docs) {
        const key = doc.income_customer_id;
        if (!key)
            continue;
        let bucket = byCustomer.get(key);
        if (!bucket) {
            bucket = { docs: [] };
            byCustomer.set(key, bucket);
        }
        bucket.docs.push(doc);
    }
    const stats = new Map();
    for (const [customerId, bucket] of byCustomer) {
        const movements = bucket.docs.flatMap(movementsFromDocument);
        const openInvoiceCount = bucket.docs.filter((d) => TAX_INVOICE_TYPES.has(d.document_type)).length;
        stats.set(customerId, {
            movements,
            open_invoice_count: openInvoiceCount,
            currency: bucket.docs[0]?.currency || 'ILS',
        });
    }
    return stats;
}
function resolveAvailableYears(docs, endCustomerId) {
    const years = new Set();
    for (const doc of docs) {
        if (doc.income_customer_id !== endCustomerId)
            continue;
        const y = issueYearFromIso(doc.issue_date);
        if (y != null)
            years.add(y);
    }
    return [...years].sort((a, b) => b - a);
}
function resolveSelectedYear(availableYears, requestedYear) {
    const currentYear = new Date().getFullYear();
    if (requestedYear != null && availableYears.includes(requestedYear))
        return requestedYear;
    if (availableYears.includes(currentYear))
        return currentYear;
    return availableYears[0] ?? currentYear;
}
export async function buildIncomeClientIncomeLedgerCardAggregate(params) {
    const orgId = params.ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    assertLedgerAccess(params.ctx);
    const representedClientId = String(params.representedClientId ?? '').trim();
    if (!representedClientId)
        throw badRequest('represented_client_id is required');
    const client = await loadRepresentedClient(orgId, representedClientId);
    const [docs, customers] = await Promise.all([
        loadLedgerDocuments(orgId, representedClientId),
        loadAllIncomeCustomersForRepresentedClient(orgId, representedClientId),
    ]);
    const statsByCustomerId = buildDocStatsByCustomerId(docs);
    const endCustomerOptions = buildLedgerEndCustomerOptions({
        customers,
        statsByCustomerId,
    });
    let selectedEndCustomerId = params.endCustomerId?.trim() || null;
    if (!selectedEndCustomerId && endCustomerOptions.length === 1) {
        selectedEndCustomerId = endCustomerOptions[0].end_customer_id;
    }
    if (selectedEndCustomerId) {
        await assertEndCustomerBelongsToRepresentedClient({
            orgId,
            representedClientId,
            endCustomerId: selectedEndCustomerId,
        });
    }
    const customerDocs = selectedEndCustomerId
        ? docs.filter((d) => d.income_customer_id === selectedEndCustomerId)
        : [];
    const availableYears = selectedEndCustomerId
        ? resolveAvailableYears(customerDocs, selectedEndCustomerId)
        : [new Date().getFullYear()];
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
            open_balance_display: formatLedgerMoneyReference(Math.max(0, totals.open_balance_reference), currency),
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
            visible: false,
            title: '',
            description: null,
        },
        document_download_path_template: '/api/v1/income/documents/{document_id}/download',
    };
}

/**
 * Income — Client income ledger card aggregate (כרטסת).
 * Invoice identity from Income documents; remaining balance and payment children from Accounting Base allocations.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { incomePaymentMethodLabel, parseIncomePaymentMethodKey, resolveIncomeInvoiceOriginalAmount, resolveIncomeInvoicePaymentState, } from '../accounting-base/accounting-base-income-payment.pure.js';
import { sumPostedAllocationsForIncomeDocuments } from '../accounting-base/accounting-base-income-payment-case.read.js';
import { incomeWorkspacePermissionsFromContext } from './income-issuer-context.service.js';
import { buildIncomeIssuedDocumentViewAction } from './income-document-view-action.pure.js';
import { buildLedgerInvoiceGroups, flattenLedgerInvoiceGroups, formatLedgerMoneyReference, INCOME_LEDGER_FINANCIAL_SOURCE, issueYearFromIso, sumLedgerRemainingBalance, } from './income-client-income-ledger-card.pure.js';
import { INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY, } from './income.types.js';
const LEDGER_INVOICE_TYPES = ['tax_invoice'];
const DOCUMENT_TYPE_LABELS = {
    tax_invoice: 'חשבונית מס',
};
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
async function loadLedgerInvoices(orgId, representedClientId) {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, document_type, document_number, issue_date, created_at, currency, totals_snapshot_json')
        .eq('organization_id', orgId)
        .eq('represented_client_id', representedClientId)
        .eq('document_status', 'issued')
        .in('document_type', LEDGER_INVOICE_TYPES)
        .order('issue_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(5000);
    throwIfSupabaseError(error, 'loadLedgerInvoices');
    return (data ?? []);
}
async function loadPostedAllocationsByInvoice(orgId, invoiceIds) {
    const byInvoice = new Map();
    for (const id of invoiceIds)
        byInvoice.set(id, []);
    if (invoiceIds.length === 0)
        return byInvoice;
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
    const allocations = (allocRows ?? []);
    const paymentIds = Array.from(new Set(allocations.map((row) => row.payment_id).filter(Boolean)));
    const paymentsById = new Map();
    if (paymentIds.length > 0) {
        const { data: payRows, error: payErr } = await supabaseAdmin
            .from('accounting_payments')
            .select('id, payment_date, payment_method_key, currency')
            .eq('organization_id', orgId)
            .in('id', paymentIds);
        throwIfSupabaseError(payErr, 'loadLedgerPostedPayments');
        for (const row of (payRows ?? [])) {
            paymentsById.set(row.id, row);
        }
    }
    for (const allocation of allocations) {
        const payment = paymentsById.get(allocation.payment_id);
        if (!payment)
            continue;
        let methodKey;
        try {
            methodKey = parseIncomePaymentMethodKey(payment.payment_method_key);
        }
        catch {
            methodKey = 'other';
        }
        const amount = Number(allocation.allocated_amount);
        if (!Number.isFinite(amount) || amount <= 0)
            continue;
        const list = byInvoice.get(allocation.source_entity_id) ?? [];
        list.push({
            payment_id: payment.id,
            allocation_id: allocation.id,
            cashbox_display: incomePaymentMethodLabel(methodKey),
            payment_date: payment.payment_date,
            amount,
            currency: payment.currency || 'ILS',
        });
        byInvoice.set(allocation.source_entity_id, list);
    }
    return byInvoice;
}
function resolveAvailableYears(docs) {
    const years = new Set();
    for (const doc of docs) {
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
    const perms = incomeWorkspacePermissionsFromContext(params.ctx);
    const representedClientId = String(params.representedClientId ?? '').trim();
    if (!representedClientId)
        throw badRequest('represented_client_id is required');
    void params.endCustomerId;
    const client = await loadRepresentedClient(orgId, representedClientId);
    const docs = await loadLedgerInvoices(orgId, representedClientId);
    const availableYears = resolveAvailableYears(docs);
    const selectedYear = resolveSelectedYear(availableYears, params.year ?? null);
    const yearDocs = docs.filter((d) => issueYearFromIso(d.issue_date) === selectedYear);
    const invoiceIds = yearDocs.map((d) => d.id);
    const [allocatedByInvoice, paymentsByInvoice] = await Promise.all([
        sumPostedAllocationsForIncomeDocuments(orgId, invoiceIds),
        loadPostedAllocationsByInvoice(orgId, invoiceIds),
    ]);
    const invoiceInputs = yearDocs.map((doc) => {
        const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
        const allocated = allocatedByInvoice.get(doc.id) ?? 0;
        const state = resolveIncomeInvoicePaymentState(original, allocated);
        return {
            income_document_id: doc.id,
            document_type_label: DOCUMENT_TYPE_LABELS.tax_invoice,
            document_number: doc.document_number,
            issue_date: doc.issue_date,
            original_amount: original,
            remaining_balance: state.remaining_balance,
            currency: doc.currency || 'ILS',
            view_action: buildIncomeIssuedDocumentViewAction({
                incomeDocumentId: doc.id,
                canView: perms.view,
            }),
            payments: paymentsByInvoice.get(doc.id) ?? [],
        };
    });
    const documents = buildLedgerInvoiceGroups(invoiceInputs);
    const rows = flattenLedgerInvoiceGroups(documents);
    const currency = yearDocs[0]?.currency ?? 'ILS';
    const openRemaining = sumLedgerRemainingBalance(invoiceInputs);
    const paymentCount = invoiceInputs.reduce((n, inv) => n + inv.payments.length, 0);
    const originalTotal = invoiceInputs.reduce((n, inv) => n + inv.original_amount, 0);
    const allocatedTotal = Math.round((originalTotal - openRemaining) * 100) / 100;
    return {
        aggregate_key: INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY,
        financial_source: INCOME_LEDGER_FINANCIAL_SOURCE,
        represented_client_id: representedClientId,
        represented_client_display_name: client.display_name,
        selected_end_customer_id: null,
        selected_end_customer_display_name: null,
        selected_year: selectedYear,
        available_years: availableYears.length > 0 ? availableYears : [selectedYear],
        end_customer_options: [],
        show_customer_picker: false,
        user_notice: null,
        summary: {
            total_debit_display: formatLedgerMoneyReference(originalTotal, currency),
            total_credit_display: formatLedgerMoneyReference(Math.max(0, allocatedTotal), currency),
            open_balance_display: formatLedgerMoneyReference(Math.max(0, openRemaining), currency),
            invoice_count: documents.length,
            payment_count: paymentCount,
            currency,
        },
        table_columns: [
            { key: 'document_type_label', label: 'סוג מסמך' },
            { key: 'document_number', label: 'מספר מסמך' },
            { key: 'issue_date_display', label: 'תאריך' },
            { key: 'original_amount_display', label: 'סכום' },
            { key: 'remaining_balance_display', label: 'יתרה' },
            { key: 'view', label: 'צפייה' },
        ],
        documents,
        rows,
        allowed_actions: ['open_document'],
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
            visible: documents.length === 0,
            title: 'אין חשבוניות מס לשנה זו',
            description: null,
        },
        document_download_path_template: '/api/v1/income/documents/{document_id}/download',
    };
}

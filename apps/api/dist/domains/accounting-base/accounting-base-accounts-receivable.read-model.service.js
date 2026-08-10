/**
 * INV-3A — accounts_receivable_aggregate composer.
 * Batch AB allocations + INV-2 due composition. No N× lifecycle/payment-case reads.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import { backendTodayIsoDate, composeInvoiceLifecycleDueDimension, } from '../income/invoice-lifecycle.pure.js';
import { customerDisplayFromSnapshot } from '../income/income-work-engine-bridge.pure.js';
import { ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT, ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION, ACCOUNTING_BASE_VIEW_PERMISSION, resolveIncomeInvoiceOriginalAmount, resolveIncomeInvoicePaymentState, } from './accounting-base-income-payment.pure.js';
import { sumPostedAllocationsForIncomeDocuments } from './accounting-base-income-payment-case.read.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import { buildAccountsReceivableAgingSummary, parseArAgingBucketFilter, } from './accounting-base-accounts-receivable-aging.pure.js';
import { buildAccountsReceivableClients, buildArClientDisplayNameMapFromScope, } from './accounting-base-accounts-receivable-clients.pure.js';
import { AR_CANDIDATE_MAX, accountsReceivableSupportedDocumentTypes, accountsReceivableUnsupportedCollectibleTypes, buildAccountsReceivableSummary, clampArPagination, filterAccountsReceivableCandidates, parseArCurrencyFilter, parseArOptionalIsoDate, parseArOverdueFilter, parseArPaymentStateFilter, paginateAccountsReceivable, sortAccountsReceivableCandidates, toAccountsReceivableRow, withAccountsReceivableAgingBucket, } from './accounting-base-accounts-receivable.pure.js';
import { ACCOUNTS_RECEIVABLE_AGGREGATE_KEY, } from './accounting-base-accounts-receivable.types.js';
function hasPerm(ctx, code) {
    return (ctx.membership?.permissions ?? []).includes(code);
}
function buildRowActions(params) {
    const canView = hasPerm(params.ctx, ACCOUNTING_BASE_VIEW_PERMISSION) || hasPerm(params.ctx, 'income.view');
    const canPay = hasPerm(params.ctx, ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION) && params.remainingBalance > 0;
    let payReason = null;
    if (!hasPerm(params.ctx, ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION)) {
        payReason = 'חסרה הרשאה לרישום תשלום';
    }
    else if (params.remainingBalance <= 0) {
        payReason = 'החשבונית כבר שולמה במלואה';
    }
    return [
        {
            action_key: 'view_income_document',
            label: 'צפייה במסמך',
            enabled: canView,
            command: null,
            reason: canView ? null : 'אין הרשאת צפייה',
            source_module: 'income',
        },
        {
            action_key: 'record_payment',
            label: 'רישום תשלום',
            enabled: canPay,
            command: ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT,
            reason: payReason,
            source_module: 'accounting_base',
        },
    ];
}
/**
 * GET /api/v1/accounting-base/aggregates/accounts-receivable
 * Financial truth: Accounting Base. Document evidence: Income. Due: INV-2 pure.
 */
export async function buildAccountsReceivableAggregate(params) {
    const orgId = params.ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    assertOrgInContext(params.ctx, orgId);
    if (!hasPerm(params.ctx, ACCOUNTING_BASE_VIEW_PERMISSION) &&
        !hasPerm(params.ctx, ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION)) {
        throw forbidden('accounting_base.view required');
    }
    const scope = await loadActiveIncomeIssuerScope(params.ctx);
    const supportedTypes = accountsReceivableSupportedDocumentTypes();
    const unsupportedCollectible = accountsReceivableUnsupportedCollectibleTypes();
    const todayIso = params.todayIso ?? backendTodayIsoDate();
    const { limit, offset } = clampArPagination(params.query.limit, params.query.offset);
    const filters = {
        payment_state: parseArPaymentStateFilter(params.query.payment_state),
        overdue: parseArOverdueFilter(params.query.overdue),
        aging_bucket: parseArAgingBucketFilter(params.query.aging_bucket),
        currency: parseArCurrencyFilter(params.query.currency),
        due_date_from: parseArOptionalIsoDate(params.query.due_date_from),
        due_date_to: parseArOptionalIsoDate(params.query.due_date_to),
        issue_date_from: parseArOptionalIsoDate(params.query.issue_date_from),
        issue_date_to: parseArOptionalIsoDate(params.query.issue_date_to),
    };
    if (supportedTypes.length === 0) {
        return emptyAggregate({
            scope,
            filters,
            limit,
            offset,
            notes: [
                'No AB-supported payment document types for A/R V1.',
                ...unsupportedCollectible.map((t) => `Collectible type "${t}" excluded — AB payment not supported.`),
            ],
        });
    }
    let q = supabaseAdmin
        .from('income_documents')
        .select('id, organization_id, issuer_business_id, represented_client_id, income_customer_id, document_type, document_number, document_status, issue_date, due_date, currency, totals_snapshot_json, customer_snapshot_json')
        .eq('organization_id', scope.org_id)
        .eq('issuer_business_id', scope.issuer_business_id)
        .eq('document_status', 'issued')
        .in('document_type', supportedTypes)
        .order('issue_date', { ascending: false })
        .limit(AR_CANDIDATE_MAX);
    if (scope.represented_client_id == null) {
        q = q.is('represented_client_id', null);
    }
    else {
        q = q.eq('represented_client_id', scope.represented_client_id);
    }
    const { data, error } = await q;
    throwIfSupabaseError(error, 'accountsReceivableLoadIssuedDocuments');
    const docs = (data ?? []);
    const ids = docs.map((d) => d.id);
    const allocatedMap = await sumPostedAllocationsForIncomeDocuments(scope.org_id, ids);
    const composed = docs.map((doc) => {
        const original = resolveIncomeInvoiceOriginalAmount(doc.totals_snapshot_json);
        const paid = allocatedMap.get(doc.id) ?? 0;
        const payment = resolveIncomeInvoicePaymentState(original, paid);
        const due = composeInvoiceLifecycleDueDimension({
            documentStatus: doc.document_status,
            documentType: doc.document_type,
            dueDate: doc.due_date,
            remainingBalance: payment.remaining_balance,
            paymentStateKey: payment.payment_state_key,
            todayIso,
        });
        const currency = String(doc.currency ?? 'ILS').trim().toUpperCase() || 'ILS';
        return withAccountsReceivableAgingBucket({
            income_document_id: doc.id,
            document_number: doc.document_number,
            document_type: doc.document_type,
            issue_date: doc.issue_date,
            due_date: doc.due_date,
            represented_client_id: doc.represented_client_id,
            customer_id: doc.income_customer_id,
            customer_display_name: customerDisplayFromSnapshot(doc.customer_snapshot_json),
            currency,
            original_amount: original,
            paid_amount: paid,
            remaining_balance: payment.remaining_balance,
            payment_state_key: payment.payment_state_key,
            due_state_key: due.state_key,
            overdue: due.overdue,
            overdue_since: due.overdue_since,
            days_overdue: due.days_overdue,
        });
    });
    // Filter → sort → summary/aging/clients on full filtered set → paginate rows only.
    const filtered = sortAccountsReceivableCandidates(filterAccountsReceivableCandidates(composed, filters));
    const summary = buildAccountsReceivableSummary(filtered);
    const aging = buildAccountsReceivableAgingSummary(filtered);
    const displayNames = buildArClientDisplayNameMapFromScope(scope);
    const clients = buildAccountsReceivableClients(filtered, displayNames);
    const { page, total_count, has_more } = paginateAccountsReceivable(filtered, limit, offset);
    const candidateCapped = docs.length >= AR_CANDIDATE_MAX;
    const notes = [
        'A/R V1 includes only AB-supported payment document types (isSupportedIncomePaymentDocumentType).',
        ...unsupportedCollectible.map((t) => `Collectible type "${t}" excluded from open A/R V1 — no AB payment orchestration.`),
        'Legacy panel/ledger/invoices-tab unpaid fields are not used.',
        'Aging (INV-3B) is a pure projection over INV-2 days_overdue; bucket boundaries are platform reporting convention (not Country Pack / Owner Panel yet).',
        'Client outstanding (INV-3C) groups by represented_client_id; self mode uses client_id null with issuer_label. Not income_customer.',
        'Client display names reuse active issuer-scope labels (no per-client N+1).',
        'Payment allocation reversal: reverse_income_payment_allocation (INV-3E); A/R recomposes from effective posted allocations.',
        ...(candidateCapped
            ? [
                `Candidate load capped at ${AR_CANDIDATE_MAX}; clients/summary/aging may be incomplete — refine filters or add SQL/RPC rollup.`,
            ]
            : []),
    ];
    return {
        aggregate_key: ACCOUNTS_RECEIVABLE_AGGREGATE_KEY,
        scope: {
            organization_id: scope.org_id,
            acting_mode: scope.acting_mode,
            issuer_business_id: scope.issuer_business_id,
            represented_client_id: scope.represented_client_id,
        },
        summary,
        aging,
        clients,
        rows: page.map((c) => toAccountsReceivableRow(c, buildRowActions({
            ctx: params.ctx,
            incomeDocumentId: c.income_document_id,
            remainingBalance: c.remaining_balance,
        }))),
        filters,
        pagination: { limit, offset, total_count, has_more },
        meta: {
            generated_at: new Date().toISOString(),
            financial_source: 'accounting_base',
            document_type_scope: supportedTypes,
            clients_totals_complete: !candidateCapped,
            notes,
        },
    };
}
function emptyAggregate(params) {
    return {
        aggregate_key: ACCOUNTS_RECEIVABLE_AGGREGATE_KEY,
        scope: {
            organization_id: params.scope.org_id,
            acting_mode: params.scope.acting_mode,
            issuer_business_id: params.scope.issuer_business_id,
            represented_client_id: params.scope.represented_client_id,
        },
        summary: {
            open_invoice_count: 0,
            unpaid_count: 0,
            partial_count: 0,
            overdue_count: 0,
            totals_by_currency: [],
        },
        aging: buildAccountsReceivableAgingSummary([]),
        clients: [],
        rows: [],
        filters: params.filters,
        pagination: {
            limit: params.limit,
            offset: params.offset,
            total_count: 0,
            has_more: false,
        },
        meta: {
            generated_at: new Date().toISOString(),
            financial_source: 'accounting_base',
            document_type_scope: accountsReceivableSupportedDocumentTypes(),
            clients_totals_complete: true,
            notes: params.notes,
        },
    };
}

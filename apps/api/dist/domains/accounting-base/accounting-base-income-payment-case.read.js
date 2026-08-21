/**
 * INV-5A / INV-3E — income_invoice_payment_case aggregate (Accounting Base financial truth).
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { loadIssuedCreditAmountsByInvoice } from '../income/income-document-tax-invoice-credit.read.js';
import { composeCollectibleAfterCredit } from '../income/income-document-tax-invoice-credit.pure.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import { ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT, ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION, ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY, ACCOUNTING_BASE_VIEW_PERMISSION, incomePaymentMethodLabel, isSupportedIncomePaymentDocumentType, parseIncomePaymentMethodKey, resolveIncomeInvoiceOriginalAmount, resolveIncomeInvoicePaymentState, } from './accounting-base-income-payment.pure.js';
function hasPerm(ctx, code) {
    return (ctx.membership?.permissions ?? []).includes(code);
}
export async function sumPostedAllocationsForIncomeDocument(organizationId, incomeDocumentId) {
    const map = await sumPostedAllocationsForIncomeDocuments(organizationId, [incomeDocumentId]);
    return map.get(incomeDocumentId) ?? 0;
}
/**
 * Effective posted allocations for paid amount.
 * Canonical rule (INV-5A / INV-3E): status='posted' AND reversal_of_allocation_id IS NULL.
 * Feeds payment_case, lifecycle, A/R, portfolio SQL.
 */
export async function sumPostedAllocationsForIncomeDocuments(organizationId, incomeDocumentIds) {
    const out = new Map();
    const ids = Array.from(new Set(incomeDocumentIds.map((id) => String(id ?? '').trim()).filter(Boolean)));
    for (const id of ids)
        out.set(id, 0);
    if (ids.length === 0)
        return out;
    const { data, error } = await supabaseAdmin
        .from('accounting_payment_allocations')
        .select('source_entity_id, allocated_amount')
        .eq('organization_id', organizationId)
        .eq('source_module', 'income')
        .in('source_entity_id', ids)
        .eq('status', 'posted')
        .is('reversal_of_allocation_id', null);
    throwIfSupabaseError(error, 'Failed to load payment allocations');
    for (const row of data ?? []) {
        const entityId = String(row.source_entity_id);
        const n = Number(row.allocated_amount);
        if (!Number.isFinite(n) || n <= 0)
            continue;
        out.set(entityId, Math.round(((out.get(entityId) ?? 0) + n) * 100) / 100);
    }
    return out;
}
function buildReverseAction(params) {
    let enabled = false;
    let reason = null;
    if (!params.canWrite) {
        reason = 'חסרה הרשאה לביטול שיוך תשלום';
    }
    else if (params.isReversal) {
        reason = 'לא ניתן לבטל שורת ביטול';
    }
    else if (params.allocationStatus === 'reversed') {
        reason = 'השיוך כבר בוטל';
    }
    else {
        enabled = true;
    }
    return {
        action_key: 'reverse_payment_allocation',
        label: 'בטל שיוך תשלום',
        enabled,
        command: ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION,
        allocation_id: params.allocationId,
        reason,
    };
}
export async function buildIncomeInvoicePaymentCaseAggregate(ctx, organizationId, incomeDocumentId) {
    assertOrgInContext(ctx, organizationId);
    if (!hasPerm(ctx, ACCOUNTING_BASE_VIEW_PERMISSION) && !hasPerm(ctx, 'accounting_base.payment.write')) {
        throw forbidden('accounting_base.view required');
    }
    const docId = String(incomeDocumentId ?? '').trim();
    if (!docId)
        throw badRequest('income_document_id required');
    const { data: doc, error: docErr } = await supabaseAdmin
        .from('income_documents')
        .select('id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, document_status, currency, totals_snapshot_json')
        .eq('organization_id', organizationId)
        .eq('id', docId)
        .maybeSingle();
    throwIfSupabaseError(docErr, 'Failed to load income document');
    if (!doc)
        throw notFound('Income document not found');
    const row = doc;
    const original = resolveIncomeInvoiceOriginalAmount(row.totals_snapshot_json);
    const allocated = await sumPostedAllocationsForIncomeDocument(organizationId, row.id);
    const credited = (await loadIssuedCreditAmountsByInvoice(organizationId, [row.id])).get(row.id) ?? 0;
    const collectible = composeCollectibleAfterCredit({
        originalAmount: original,
        creditedAmount: credited,
        allocatedPayments: allocated,
    });
    const state = {
        ...resolveIncomeInvoicePaymentState(collectible.net_invoice_amount > 0 ? collectible.net_invoice_amount : original, allocated),
        remaining_balance: collectible.remaining_receivable,
        payment_state_key: collectible.payment_state_key,
        payment_state_label: collectible.payment_state_label,
        payment_state_tone: collectible.payment_state_tone,
    };
    const canWrite = hasPerm(ctx, 'accounting_base.payment.write');
    const { data: allocRows, error: allocErr } = await supabaseAdmin
        .from('accounting_payment_allocations')
        .select('id, payment_id, allocated_amount, currency, created_at, status, reversal_of_allocation_id')
        .eq('organization_id', organizationId)
        .eq('source_module', 'income')
        .eq('source_entity_id', row.id)
        .order('created_at', { ascending: true });
    throwIfSupabaseError(allocErr, 'Failed to load allocations');
    const paymentIds = Array.from(new Set((allocRows ?? []).map((a) => String(a.payment_id))));
    const paymentsById = new Map();
    if (paymentIds.length > 0) {
        const { data: payRows, error: payErr } = await supabaseAdmin
            .from('accounting_payments')
            .select('id, payment_date, payment_method_key, amount, currency, reference_number, status')
            .eq('organization_id', organizationId)
            .in('id', paymentIds);
        throwIfSupabaseError(payErr, 'Failed to load payments');
        for (const p of payRows ?? []) {
            const pr = p;
            paymentsById.set(pr.id, pr);
        }
    }
    const history = [];
    for (const a of allocRows ?? []) {
        const ar = a;
        const pay = paymentsById.get(ar.payment_id);
        if (!pay)
            continue;
        let methodKey;
        try {
            methodKey = parseIncomePaymentMethodKey(pay.payment_method_key);
        }
        catch {
            methodKey = 'other';
        }
        const allocation_status = ar.status === 'reversed' ? 'reversed' : 'posted';
        const is_reversal = ar.reversal_of_allocation_id != null;
        history.push({
            payment_id: pay.id,
            allocation_id: ar.id,
            payment_date: pay.payment_date,
            payment_method_key: methodKey,
            payment_method_label: incomePaymentMethodLabel(methodKey),
            amount: Number(ar.allocated_amount),
            currency: ar.currency,
            reference_number: pay.reference_number,
            allocation_status,
            is_reversal,
            reversal_of_allocation_id: ar.reversal_of_allocation_id,
            reverse_action: buildReverseAction({
                canWrite,
                allocationId: ar.id,
                allocationStatus: allocation_status,
                isReversal: is_reversal,
            }),
        });
    }
    const payments = history.filter((p) => p.allocation_status === 'posted' && !p.is_reversal);
    const canRecord = canWrite &&
        row.document_status === 'issued' &&
        isSupportedIncomePaymentDocumentType(row.document_type) &&
        state.remaining_balance > 0;
    let recordReason = null;
    if (!canWrite) {
        recordReason = 'חסרה הרשאה לרישום תשלום';
    }
    else if (row.document_status !== 'issued') {
        recordReason = 'ניתן לרשום תשלום רק למסמך שהופק';
    }
    else if (!isSupportedIncomePaymentDocumentType(row.document_type)) {
        recordReason = 'סוג מסמך אינו נתמך לרישום תשלום';
    }
    else if (state.remaining_balance <= 0) {
        recordReason = 'החשבונית כבר שולמה במלואה';
    }
    return {
        aggregate_key: ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY,
        financial_source: 'accounting_base',
        income_document_id: row.id,
        document_number: row.document_number,
        document_type: row.document_type,
        issuer_business_id: row.issuer_business_id,
        represented_client_id: row.represented_client_id,
        original_amount: original,
        allocated_amount: allocated,
        remaining_balance: state.remaining_balance,
        currency: row.currency || 'ILS',
        payment_state_key: state.payment_state_key,
        payment_state_label: state.payment_state_label,
        payment_state_tone: state.payment_state_tone,
        payments,
        allocation_history: history,
        allowed_actions: [
            {
                action_key: 'record_payment',
                label: 'רישום תשלום',
                enabled: canRecord,
                command: ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT,
                reason: recordReason,
            },
        ],
    };
}

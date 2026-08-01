/**
 * INV-5A — income_invoice_payment_case aggregate (Accounting Base financial truth).
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import { ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY, ACCOUNTING_BASE_VIEW_PERMISSION, incomePaymentMethodLabel, isSupportedIncomePaymentDocumentType, parseIncomePaymentMethodKey, resolveIncomeInvoiceOriginalAmount, resolveIncomeInvoicePaymentState, } from './accounting-base-income-payment.pure.js';
function hasPerm(ctx, code) {
    return (ctx.membership?.permissions ?? []).includes(code);
}
export async function sumPostedAllocationsForIncomeDocument(organizationId, incomeDocumentId) {
    const map = await sumPostedAllocationsForIncomeDocuments(organizationId, [incomeDocumentId]);
    return map.get(incomeDocumentId) ?? 0;
}
/** Batch posted allocation totals by income document id (Accounting Base truth). */
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
    const state = resolveIncomeInvoicePaymentState(original, allocated);
    const { data: allocRows, error: allocErr } = await supabaseAdmin
        .from('accounting_payment_allocations')
        .select('id, payment_id, allocated_amount, currency, created_at')
        .eq('organization_id', organizationId)
        .eq('source_module', 'income')
        .eq('source_entity_id', row.id)
        .eq('status', 'posted')
        .is('reversal_of_allocation_id', null)
        .order('created_at', { ascending: true });
    throwIfSupabaseError(allocErr, 'Failed to load allocations');
    const paymentIds = Array.from(new Set((allocRows ?? []).map((a) => String(a.payment_id))));
    const paymentsById = new Map();
    if (paymentIds.length > 0) {
        const { data: payRows, error: payErr } = await supabaseAdmin
            .from('accounting_payments')
            .select('id, payment_date, payment_method_key, amount, currency, reference_number')
            .eq('organization_id', organizationId)
            .in('id', paymentIds);
        throwIfSupabaseError(payErr, 'Failed to load payments');
        for (const p of payRows ?? []) {
            const pr = p;
            paymentsById.set(pr.id, pr);
        }
    }
    const payments = [];
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
        payments.push({
            payment_id: pay.id,
            allocation_id: ar.id,
            payment_date: pay.payment_date,
            payment_method_key: methodKey,
            payment_method_label: incomePaymentMethodLabel(methodKey),
            amount: Number(ar.allocated_amount),
            currency: ar.currency,
            reference_number: pay.reference_number,
        });
    }
    const canRecord = hasPerm(ctx, 'accounting_base.payment.write') &&
        row.document_status === 'issued' &&
        isSupportedIncomePaymentDocumentType(row.document_type) &&
        state.remaining_balance > 0;
    let recordReason = null;
    if (!hasPerm(ctx, 'accounting_base.payment.write')) {
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
        allowed_actions: [
            {
                action_key: 'record_payment',
                label: 'רישום תשלום',
                enabled: canRecord,
                command: 'record_and_allocate_income_payment',
                reason: recordReason,
            },
        ],
    };
}

/**
 * Credit-note lineage reads. No command/workspace imports (avoids cycles).
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { roundMoney2 } from '../accounting-base/accounting-base-income-payment.pure.js';
import { INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT, INCOME_TAX_INVOICE_CREDIT_REASON_OPTIONS, creditSourceReferenceDisplay, } from './income-document-tax-invoice-credit.pure.js';
export function buildTaxInvoiceCreditAction(params) {
    let enabled = true;
    let disabled_reason = null;
    if (!params.canEdit) {
        enabled = false;
        disabled_reason = 'אין הרשאת עריכה';
    }
    else if (!params.creditTypeEnabled) {
        enabled = false;
        disabled_reason = 'חשבונית מס/זיכוי אינה זמינה למנפיק';
    }
    else if (params.remainingCreditable <= 0.005) {
        enabled = false;
        disabled_reason = 'החשבונית כבר זוכתה במלואה';
    }
    return {
        visible: true,
        enabled,
        label: 'ביטול מסמך',
        command: INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT,
        disabled_reason,
        modes: [
            { key: 'full', label: 'זיכוי מלא' },
            { key: 'partial', label: 'זיכוי חלקי' },
        ],
        reason_options: INCOME_TAX_INVOICE_CREDIT_REASON_OPTIONS,
        reason_required: true,
    };
}
export async function loadIssuedCreditAmountsByInvoice(orgId, invoiceIds) {
    const byInvoice = new Map();
    for (const id of invoiceIds)
        byInvoice.set(id, 0);
    if (invoiceIds.length === 0)
        return byInvoice;
    const { data, error } = await supabaseAdmin
        .from('income_document_credit_links')
        .select('source_invoice_id, credited_amount_reference')
        .eq('organization_id', orgId)
        .in('source_invoice_id', invoiceIds)
        .eq('status', 'issued');
    throwIfSupabaseError(error, 'loadIssuedCreditAmountsByInvoice', {
        migrationHint: '161_income_tax_invoice_credit_lineage.sql',
    });
    for (const row of (data ?? [])) {
        const current = byInvoice.get(row.source_invoice_id) ?? 0;
        byInvoice.set(row.source_invoice_id, roundMoney2(current + Number(row.credited_amount_reference ?? 0)));
    }
    return byInvoice;
}
export async function loadIssuedCreditRowsForInvoices(orgId, invoiceIds) {
    if (invoiceIds.length === 0)
        return [];
    const { data, error } = await supabaseAdmin
        .from('income_document_credit_links')
        .select('source_invoice_id, credit_document_id, credited_amount_reference')
        .eq('organization_id', orgId)
        .in('source_invoice_id', invoiceIds)
        .eq('status', 'issued')
        .not('credit_document_id', 'is', null);
    throwIfSupabaseError(error, 'loadIssuedCreditRowsForInvoices', {
        migrationHint: '161_income_tax_invoice_credit_lineage.sql',
    });
    return (data ?? [])
        .filter((row) => row.credit_document_id)
        .map((row) => ({
        source_invoice_id: row.source_invoice_id,
        credit_document_id: String(row.credit_document_id),
        credited_amount_reference: Number(row.credited_amount_reference ?? 0),
    }));
}
export async function loadCreditSourceReferenceForDocument(orgId, creditDocumentId) {
    const { data, error } = await supabaseAdmin
        .from('income_document_credit_links')
        .select('source_invoice_number')
        .eq('organization_id', orgId)
        .eq('credit_document_id', creditDocumentId)
        .eq('status', 'issued')
        .maybeSingle();
    throwIfSupabaseError(error, 'loadCreditSourceReferenceForDocument', {
        migrationHint: '161_income_tax_invoice_credit_lineage.sql',
    });
    const number = data?.source_invoice_number;
    return number ? creditSourceReferenceDisplay(number) : null;
}

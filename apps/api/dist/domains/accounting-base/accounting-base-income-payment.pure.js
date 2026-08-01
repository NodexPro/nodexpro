/**
 * INV-5A — pure helpers for Income invoice payment allocation (Accounting Base truth).
 */
export const ACCOUNTING_BASE_INCOME_PAYMENT_CASE_KEY = 'income_invoice_payment_case';
export const ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT = 'record_and_allocate_income_payment';
export const ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION = 'accounting_base.payment.write';
export const ACCOUNTING_BASE_VIEW_PERMISSION = 'accounting_base.view';
const PAYMENT_METHOD_LABELS = {
    bank_transfer: 'העברה בנקאית',
    cash: 'מזומן',
    check: "צ'ק",
    credit_card: 'כרטיס אשראי',
    other: 'אחר',
};
export function roundMoney2(value) {
    return Math.round(value * 100) / 100;
}
/** Invoice original amount from trusted issued totals snapshot (AB payment foundation). */
export function resolveIncomeInvoiceOriginalAmount(totalsSnapshot) {
    if (!totalsSnapshot || typeof totalsSnapshot !== 'object')
        return 0;
    const grand = totalsSnapshot.grand_total_reference;
    if (typeof grand === 'number' && Number.isFinite(grand) && grand >= 0) {
        return roundMoney2(grand);
    }
    const amountRef = totalsSnapshot.amount_reference;
    if (typeof amountRef === 'number' && Number.isFinite(amountRef) && amountRef >= 0) {
        return roundMoney2(amountRef);
    }
    const sub = totalsSnapshot.subtotal_reference;
    if (typeof sub === 'number' && Number.isFinite(sub) && sub >= 0) {
        return roundMoney2(sub);
    }
    return 0;
}
export function resolveIncomeInvoicePaymentState(originalAmount, allocatedAmount) {
    const original = roundMoney2(Math.max(0, originalAmount));
    const allocated = roundMoney2(Math.max(0, allocatedAmount));
    const remaining = roundMoney2(Math.max(0, original - allocated));
    if (remaining <= 0 && original > 0) {
        return {
            payment_state_key: 'paid',
            payment_state_label: 'שולם',
            payment_state_tone: 'success',
            remaining_balance: 0,
        };
    }
    if (allocated > 0 && remaining > 0) {
        return {
            payment_state_key: 'partial',
            payment_state_label: 'שולם חלקית',
            payment_state_tone: 'warning',
            remaining_balance: remaining,
        };
    }
    return {
        payment_state_key: 'unpaid',
        payment_state_label: 'לא שולם',
        payment_state_tone: 'danger',
        remaining_balance: remaining,
    };
}
export function parseIncomePaymentMethodKey(value) {
    const key = String(value ?? '').trim();
    if (!(key in PAYMENT_METHOD_LABELS)) {
        throw new Error(`Unsupported payment_method_key: ${String(value ?? '')}`);
    }
    return key;
}
export function incomePaymentMethodLabel(key) {
    return PAYMENT_METHOD_LABELS[key];
}
export function isSupportedIncomePaymentDocumentType(documentType) {
    return documentType === 'tax_invoice';
}

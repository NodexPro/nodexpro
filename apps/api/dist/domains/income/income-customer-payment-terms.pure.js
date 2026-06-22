import { badRequest } from '../../shared/errors.js';
export const INCOME_CUSTOMER_PAYMENT_TERMS_KEYS = [
    'immediate',
    'eom_plus_30',
    'eom_plus_60',
    'eom_plus_90',
];
export const DEFAULT_INCOME_CUSTOMER_PAYMENT_TERMS = 'eom_plus_30';
export const INCOME_CUSTOMER_PAYMENT_TERMS_OPTIONS = [
    { value: 'immediate', label: 'מיידי' },
    { value: 'eom_plus_30', label: 'שוטף + 30' },
    { value: 'eom_plus_60', label: 'שוטף + 60' },
    { value: 'eom_plus_90', label: 'שוטף + 90' },
];
const PAYMENT_TERMS_LABEL_BY_KEY = new Map(INCOME_CUSTOMER_PAYMENT_TERMS_OPTIONS.map((o) => [o.value, o.label]));
export function isIncomeCustomerPaymentTermsKey(value) {
    return INCOME_CUSTOMER_PAYMENT_TERMS_KEYS.includes(value);
}
export function parseIncomeCustomerPaymentTermsKey(raw, field = 'default_payment_terms') {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!isIncomeCustomerPaymentTermsKey(value)) {
        throw badRequest(`${field} must be one of: ${INCOME_CUSTOMER_PAYMENT_TERMS_KEYS.join(', ')}`);
    }
    return value;
}
export function incomeCustomerPaymentTermsLabel(key) {
    return PAYMENT_TERMS_LABEL_BY_KEY.get(key) ?? key;
}
function parseIsoDateParts(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match)
        throw badRequest('document_date must be YYYY-MM-DD');
    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
    };
}
function formatIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function endOfMonthIso(documentDateIso) {
    const { year, month } = parseIsoDateParts(documentDateIso);
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
function addDaysIso(iso, days) {
    const { year, month, day } = parseIsoDateParts(iso);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return formatIsoDate(date);
}
/** Israeli payment terms: מיידי or שוטף (end of invoice month) + N days. */
export function computeDueDateFromPaymentTerms(documentDateIso, terms) {
    if (terms === 'immediate')
        return documentDateIso;
    const endOfMonth = endOfMonthIso(documentDateIso);
    const extraDays = terms === 'eom_plus_30' ? 30 : terms === 'eom_plus_60' ? 60 : 90;
    return addDaysIso(endOfMonth, extraDays);
}
export function resolveTaxInvoiceDueDate(params) {
    if (params.dueDateManualOverride && params.storedDueDate) {
        return params.storedDueDate;
    }
    return computeDueDateFromPaymentTerms(params.documentDateIso, params.paymentTerms);
}

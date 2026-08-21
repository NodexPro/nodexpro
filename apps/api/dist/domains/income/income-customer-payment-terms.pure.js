import { badRequest } from '../../shared/errors.js';
import { calendarDateIso } from './income-document-semantic-dates.pure.js';
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
export function paymentTermsKeyFromUnknown(raw) {
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        return isIncomeCustomerPaymentTermsKey(trimmed) ? trimmed : null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const o = raw;
    return paymentTermsKeyFromUnknown(o.key ?? o.payment_terms_key);
}
/** Persist the due date the tax-invoice document actually displayed. */
export function resolveTaxInvoiceDueDateForIssue(params) {
    const stored = calendarDateIso(params.storedDueDate);
    const documentDate = calendarDateIso(params.documentDateIso);
    if (documentDate && params.paymentTerms) {
        return resolveTaxInvoiceDueDate({
            documentDateIso: documentDate,
            paymentTerms: params.paymentTerms,
            storedDueDate: stored,
            dueDateManualOverride: params.dueDateManualOverride,
        });
    }
    return stored;
}
/**
 * Due date that belongs on the issued document.
 * Uses stored due_date when present; otherwise payment-terms date from the document date.
 * Does not invent a due date from issue_date alone.
 */
export function resolveIncomeDueDateFromDocument(params) {
    const stored = calendarDateIso(params.storedDueDate);
    if (stored)
        return stored;
    const documentDate = calendarDateIso(params.documentDateIso);
    if (!documentDate || !params.paymentTerms)
        return null;
    return computeDueDateFromPaymentTerms(documentDate, params.paymentTerms);
}

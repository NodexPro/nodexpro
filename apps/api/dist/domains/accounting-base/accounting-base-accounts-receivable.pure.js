/**
 * INV-3A — pure helpers for accounts receivable list composition.
 * Reuses AB payment state + INV-2 due composition. No duplicate formulas.
 */
import { roundMoney2 } from './accounting-base-income-payment.pure.js';
import { isSupportedIncomePaymentDocumentType } from './accounting-base-income-payment.pure.js';
import { accountsReceivableAgingLabel, accountsReceivableAgingLabelHe, resolveAccountsReceivableAgingBucket, } from './accounting-base-accounts-receivable-aging.pure.js';
/** Document types that could be collectible — filtered by AB payment support for V1. */
const COLLECTIBLE_CANDIDATE_TYPES = [
    'tax_invoice',
    'tax_invoice_receipt',
    'deal_invoice',
];
/** A/R V1 document types: only those with authoritative AB payment truth. */
export function accountsReceivableSupportedDocumentTypes() {
    return COLLECTIBLE_CANDIDATE_TYPES.filter((t) => isSupportedIncomePaymentDocumentType(t));
}
/** Collectible types excluded from V1 because AB payment is unsupported. */
export function accountsReceivableUnsupportedCollectibleTypes() {
    return COLLECTIBLE_CANDIDATE_TYPES.filter((t) => !isSupportedIncomePaymentDocumentType(t));
}
export const AR_DEFAULT_LIMIT = 50;
export const AR_MAX_LIMIT = 200;
/** Max issued candidates loaded per scope before open-filter (bounded hydrate). */
export const AR_CANDIDATE_MAX = 2000;
export function clampArPagination(rawLimit, rawOffset) {
    let limit = Number(rawLimit ?? AR_DEFAULT_LIMIT);
    if (!Number.isFinite(limit) || limit <= 0)
        limit = AR_DEFAULT_LIMIT;
    if (limit > AR_MAX_LIMIT)
        limit = AR_MAX_LIMIT;
    limit = Math.floor(limit);
    let offset = Number(rawOffset ?? 0);
    if (!Number.isFinite(offset) || offset < 0)
        offset = 0;
    offset = Math.floor(offset);
    return { limit, offset };
}
export function parseArPaymentStateFilter(raw) {
    const v = String(raw ?? 'all_open').trim();
    if (v === 'unpaid' || v === 'partial' || v === 'all_open')
        return v;
    return 'all_open';
}
export function parseArOverdueFilter(raw) {
    const v = String(raw ?? 'all').trim();
    if (v === 'true' || v === 'false' || v === 'all')
        return v;
    return 'all';
}
function parseIsoDate(raw) {
    const s = String(raw ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        return null;
    return s;
}
export function parseArOptionalIsoDate(raw) {
    if (raw == null || String(raw).trim() === '')
        return null;
    return parseIsoDate(raw);
}
export function parseArCurrencyFilter(raw) {
    const s = String(raw ?? '').trim().toUpperCase();
    if (!s)
        return null;
    if (!/^[A-Z]{3}$/.test(s))
        return null;
    return s;
}
/** Open A/R = remaining_balance > 0 (paid excluded). */
export function isOpenAccountsReceivableRow(row) {
    return roundMoney2(row.remaining_balance) > 0;
}
/** Attach aging_bucket_key from INV-2 overdue fields (pure; no DB). */
export function withAccountsReceivableAgingBucket(row) {
    return {
        ...row,
        aging_bucket_key: resolveAccountsReceivableAgingBucket({
            overdue: row.overdue,
            days_overdue: row.days_overdue,
        }),
    };
}
export function filterAccountsReceivableCandidates(rows, filters) {
    return rows.filter((row) => {
        if (!isOpenAccountsReceivableRow(row))
            return false;
        if (filters.payment_state === 'unpaid' && row.payment_state_key !== 'unpaid')
            return false;
        if (filters.payment_state === 'partial' && row.payment_state_key !== 'partial')
            return false;
        if (filters.overdue === 'true' && !row.overdue)
            return false;
        if (filters.overdue === 'false' && row.overdue)
            return false;
        if (filters.aging_bucket !== 'all' && row.aging_bucket_key !== filters.aging_bucket)
            return false;
        if (filters.currency && row.currency !== filters.currency)
            return false;
        if (filters.due_date_from && (!row.due_date || row.due_date < filters.due_date_from))
            return false;
        if (filters.due_date_to && (!row.due_date || row.due_date > filters.due_date_to))
            return false;
        if (filters.issue_date_from && (!row.issue_date || row.issue_date < filters.issue_date_from)) {
            return false;
        }
        if (filters.issue_date_to && (!row.issue_date || row.issue_date > filters.issue_date_to)) {
            return false;
        }
        return true;
    });
}
/** Stable sort: overdue first by days desc, then due_date asc, issue_date asc, number. */
export function sortAccountsReceivableCandidates(rows) {
    return [...rows].sort((a, b) => {
        if (a.overdue !== b.overdue)
            return a.overdue ? -1 : 1;
        if (a.overdue && b.overdue) {
            const da = a.days_overdue ?? 0;
            const db = b.days_overdue ?? 0;
            if (da !== db)
                return db - da;
        }
        const dueA = a.due_date ?? '9999-12-31';
        const dueB = b.due_date ?? '9999-12-31';
        if (dueA !== dueB)
            return dueA.localeCompare(dueB);
        const issA = a.issue_date ?? '';
        const issB = b.issue_date ?? '';
        if (issA !== issB)
            return issA.localeCompare(issB);
        return a.document_number.localeCompare(b.document_number, 'he');
    });
}
export function paginateAccountsReceivable(rows, limit, offset) {
    const total_count = rows.length;
    const page = rows.slice(offset, offset + limit);
    return { page, total_count, has_more: offset + page.length < total_count };
}
/** Never sum across currencies — one bucket per currency code. */
export function buildAccountsReceivableTotalsByCurrency(rows) {
    const map = new Map();
    for (const row of rows) {
        const currency = row.currency || 'ILS';
        const cur = map.get(currency) ?? {
            currency,
            open_invoice_count: 0,
            original_amount: 0,
            paid_amount: 0,
            remaining_balance: 0,
        };
        cur.open_invoice_count += 1;
        cur.original_amount = roundMoney2(cur.original_amount + row.original_amount);
        cur.paid_amount = roundMoney2(cur.paid_amount + row.paid_amount);
        cur.remaining_balance = roundMoney2(cur.remaining_balance + row.remaining_balance);
        map.set(currency, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}
export function buildAccountsReceivableSummary(rows) {
    return {
        open_invoice_count: rows.length,
        unpaid_count: rows.filter((r) => r.payment_state_key === 'unpaid').length,
        partial_count: rows.filter((r) => r.payment_state_key === 'partial').length,
        overdue_count: rows.filter((r) => r.overdue).length,
        totals_by_currency: buildAccountsReceivableTotalsByCurrency(rows),
    };
}
export function toAccountsReceivableRow(candidate, allowed_actions) {
    return {
        income_document_id: candidate.income_document_id,
        document_number: candidate.document_number,
        document_type: candidate.document_type,
        issue_date: candidate.issue_date,
        due_date: candidate.due_date,
        customer: {
            id: candidate.customer_id,
            display_name: candidate.customer_display_name,
        },
        currency: candidate.currency,
        original_amount: candidate.original_amount,
        paid_amount: candidate.paid_amount,
        remaining_balance: candidate.remaining_balance,
        payment_state_key: candidate.payment_state_key,
        financial_source: 'accounting_base',
        due_state_key: candidate.due_state_key,
        overdue: candidate.overdue,
        overdue_since: candidate.overdue_since,
        days_overdue: candidate.days_overdue,
        aging_bucket_key: candidate.aging_bucket_key,
        aging_label: accountsReceivableAgingLabel(candidate.aging_bucket_key),
        aging_label_he: accountsReceivableAgingLabelHe(candidate.aging_bucket_key),
        allowed_actions,
    };
}

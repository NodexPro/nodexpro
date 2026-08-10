/**
 * INV-3B — A/R aging bucket classification (pure over INV-2/3A due truth).
 * Platform reporting convention — not Country Pack / Owner Panel yet.
 */
import { roundMoney2 } from './accounting-base-income-payment.pure.js';
export const ACCOUNTS_RECEIVABLE_AGING_BUCKET_KEYS = [
    'current',
    '1_30',
    '31_60',
    '61_90',
    '90_plus',
];
const AGING_LABEL_HE = {
    current: 'שוטף',
    '1_30': '1–30',
    '31_60': '31–60',
    '61_90': '61–90',
    '90_plus': '90+',
};
const AGING_LABEL_EN = {
    current: 'Current',
    '1_30': '1–30 days',
    '31_60': '31–60 days',
    '61_90': '61–90 days',
    '90_plus': '90+ days',
};
/**
 * Canonical V1 aging from INV-2 overdue truth.
 *
 * - current: not overdue (includes due today/future, and no due date → not_applicable)
 * - 1_30 / 31_60 / 61_90 / 90_plus: days_overdue ranges
 *
 * No-due-date: INV-2 sets overdue=false → current (no separate unclassified bucket).
 */
export function resolveAccountsReceivableAgingBucket(params) {
    if (!params.overdue)
        return 'current';
    const days = params.days_overdue;
    if (days == null || !Number.isFinite(days) || days <= 0)
        return 'current';
    if (days <= 30)
        return '1_30';
    if (days <= 60)
        return '31_60';
    if (days <= 90)
        return '61_90';
    return '90_plus';
}
export function accountsReceivableAgingLabelHe(key) {
    return AGING_LABEL_HE[key];
}
export function accountsReceivableAgingLabel(key) {
    return AGING_LABEL_EN[key];
}
export function parseArAgingBucketFilter(raw) {
    const v = String(raw ?? 'all').trim();
    if (v === 'all')
        return 'all';
    if (ACCOUNTS_RECEIVABLE_AGING_BUCKET_KEYS.includes(v)) {
        return v;
    }
    return 'all';
}
/** Aging summary over filtered open rows — remaining_balance by bucket × currency only. */
export function buildAccountsReceivableAgingSummary(rows) {
    const byBucket = new Map();
    const counts = new Map();
    for (const key of ACCOUNTS_RECEIVABLE_AGING_BUCKET_KEYS) {
        byBucket.set(key, new Map());
        counts.set(key, 0);
    }
    for (const row of rows) {
        const bucket = row.aging_bucket_key;
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
        const currencyMap = byBucket.get(bucket);
        const currency = row.currency || 'ILS';
        const cur = currencyMap.get(currency) ?? { currency, remaining_balance: 0 };
        cur.remaining_balance = roundMoney2(cur.remaining_balance + row.remaining_balance);
        currencyMap.set(currency, cur);
    }
    return {
        buckets: ACCOUNTS_RECEIVABLE_AGING_BUCKET_KEYS.map((bucket_key) => ({
            bucket_key,
            label: accountsReceivableAgingLabel(bucket_key),
            label_he: accountsReceivableAgingLabelHe(bucket_key),
            invoice_count: counts.get(bucket_key) ?? 0,
            totals_by_currency: Array.from(byBucket.get(bucket_key).values()).sort((a, b) => a.currency.localeCompare(b.currency)),
        })),
    };
}

/**
 * INV-3D — pure composition of portfolio grain → summary / aging / clients.
 * No candidate-cap; no FE math; no cross-currency grand totals.
 */
import { roundMoney2 } from './accounting-base-income-payment.pure.js';
import { ACCOUNTS_RECEIVABLE_AGING_BUCKET_KEYS, accountsReceivableAgingLabel, accountsReceivableAgingLabelHe, } from './accounting-base-accounts-receivable-aging.pure.js';
/** SQL aging helper equivalence: same boundaries as INV-3B + INV-2 (due today = current). */
export function resolveAccountsReceivableAgingBucketFromDueDate(params) {
    const due = params.dueDate;
    const today = params.todayIso;
    if (!due)
        return 'current';
    if (due >= today)
        return 'current';
    const days = Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${due}T00:00:00.000Z`)) / 86_400_000);
    if (days <= 30)
        return '1_30';
    if (days <= 60)
        return '31_60';
    if (days <= 90)
        return '61_90';
    return '90_plus';
}
export function buildPortfolioSummaryFromGrain(grains) {
    let open_invoice_count = 0;
    let unpaid_count = 0;
    let partial_count = 0;
    let overdue_count = 0;
    const byCurrency = new Map();
    for (const g of grains) {
        open_invoice_count += g.invoice_count;
        if (g.payment_state_key === 'unpaid')
            unpaid_count += g.invoice_count;
        if (g.payment_state_key === 'partial')
            partial_count += g.invoice_count;
        if (g.overdue)
            overdue_count += g.invoice_count;
        const currency = g.currency || 'ILS';
        const cur = byCurrency.get(currency) ?? {
            currency,
            open_invoice_count: 0,
            original_amount: 0,
            paid_amount: 0,
            remaining_balance: 0,
            overdue_remaining_balance: 0,
        };
        cur.open_invoice_count += g.invoice_count;
        cur.original_amount = roundMoney2(cur.original_amount + g.original_amount);
        cur.paid_amount = roundMoney2(cur.paid_amount + g.paid_amount);
        cur.remaining_balance = roundMoney2(cur.remaining_balance + g.remaining_balance);
        cur.overdue_remaining_balance = roundMoney2(cur.overdue_remaining_balance + g.overdue_remaining_balance);
        byCurrency.set(currency, cur);
    }
    return {
        open_invoice_count,
        unpaid_count,
        partial_count,
        overdue_count,
        totals_by_currency: Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
    };
}
export function buildPortfolioAgingFromGrain(grains) {
    const counts = new Map();
    const money = new Map();
    for (const key of ACCOUNTS_RECEIVABLE_AGING_BUCKET_KEYS) {
        counts.set(key, 0);
        money.set(key, new Map());
    }
    for (const g of grains) {
        const bucket = g.aging_bucket_key;
        counts.set(bucket, (counts.get(bucket) ?? 0) + g.invoice_count);
        const curMap = money.get(bucket);
        const currency = g.currency || 'ILS';
        curMap.set(currency, roundMoney2((curMap.get(currency) ?? 0) + g.remaining_balance));
    }
    return {
        buckets: ACCOUNTS_RECEIVABLE_AGING_BUCKET_KEYS.map((bucket_key) => ({
            bucket_key,
            label: accountsReceivableAgingLabel(bucket_key),
            label_he: accountsReceivableAgingLabelHe(bucket_key),
            invoice_count: counts.get(bucket_key) ?? 0,
            totals_by_currency: Array.from(money.get(bucket_key).entries())
                .map(([currency, remaining_balance]) => ({ currency, remaining_balance }))
                .sort((a, b) => a.currency.localeCompare(b.currency)),
        })),
    };
}
export function buildPortfolioClientsFromGrain(grains, displayNameByClientId) {
    const byClient = new Map();
    for (const g of grains) {
        let acc = byClient.get(g.represented_client_id);
        if (!acc) {
            acc = {
                client_id: g.represented_client_id,
                open_invoice_count: 0,
                unpaid_count: 0,
                partial_count: 0,
                overdue_count: 0,
                currencyMap: new Map(),
                agingGrains: [],
            };
            byClient.set(g.represented_client_id, acc);
        }
        acc.open_invoice_count += g.invoice_count;
        if (g.payment_state_key === 'unpaid')
            acc.unpaid_count += g.invoice_count;
        if (g.payment_state_key === 'partial')
            acc.partial_count += g.invoice_count;
        if (g.overdue)
            acc.overdue_count += g.invoice_count;
        acc.agingGrains.push(g);
        const currency = g.currency || 'ILS';
        const cur = acc.currencyMap.get(currency) ?? {
            currency,
            original_amount: 0,
            paid_amount: 0,
            remaining_balance: 0,
            overdue_remaining_balance: 0,
        };
        cur.original_amount = roundMoney2(cur.original_amount + g.original_amount);
        cur.paid_amount = roundMoney2(cur.paid_amount + g.paid_amount);
        cur.remaining_balance = roundMoney2(cur.remaining_balance + g.remaining_balance);
        cur.overdue_remaining_balance = roundMoney2(cur.overdue_remaining_balance + g.overdue_remaining_balance);
        acc.currencyMap.set(currency, cur);
    }
    const clients = Array.from(byClient.values()).map((acc) => ({
        client_id: acc.client_id,
        client_display_name: displayNameByClientId.get(acc.client_id) ?? null,
        open_invoice_count: acc.open_invoice_count,
        unpaid_count: acc.unpaid_count,
        partial_count: acc.partial_count,
        overdue_count: acc.overdue_count,
        totals_by_currency: Array.from(acc.currencyMap.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
        aging: buildPortfolioAgingFromGrain(acc.agingGrains),
    }));
    // Stable portfolio sort: overdue_count desc, then display name (no cross-currency debt sort).
    return clients.sort((a, b) => {
        if (a.overdue_count !== b.overdue_count)
            return b.overdue_count - a.overdue_count;
        const na = (a.client_display_name ?? '').trim();
        const nb = (b.client_display_name ?? '').trim();
        if (na !== nb)
            return na.localeCompare(nb, 'he');
        return (a.client_id ?? '').localeCompare(b.client_id ?? '');
    });
}
export function parseOptionalUuid(raw) {
    const s = String(raw ?? '').trim();
    if (!s)
        return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
        return null;
    }
    return s.toLowerCase();
}

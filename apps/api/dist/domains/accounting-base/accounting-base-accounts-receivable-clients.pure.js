/**
 * INV-3C — client-level A/R outstanding (pure over INV-3A/3B filtered rows).
 * Groups by represented_client_id (office). Self mode: one group with client_id null.
 */
import { roundMoney2 } from './accounting-base-income-payment.pure.js';
import { buildAccountsReceivableAgingSummary } from './accounting-base-accounts-receivable-aging.pure.js';
/** Stable group key: represented_client_id, or "__self__" when null (self mode). Not a fake UUID. */
export function accountsReceivableClientGroupKey(representedClientId) {
    return representedClientId ?? '__self__';
}
export function resolveAccountsReceivableClientId(representedClientId) {
    return representedClientId ?? null;
}
function emptyCurrency(currency) {
    return {
        currency,
        original_amount: 0,
        paid_amount: 0,
        remaining_balance: 0,
        overdue_remaining_balance: 0,
    };
}
/**
 * Group filtered open A/R rows by represented_client_id.
 * Display names come from caller-supplied map (scope labels / batch Core clients) — no N+1 here.
 */
export function buildAccountsReceivableClients(rows, displayNameByClientKey) {
    const byKey = new Map();
    for (const row of rows) {
        const key = accountsReceivableClientGroupKey(row.represented_client_id);
        let acc = byKey.get(key);
        if (!acc) {
            acc = {
                client_id: resolveAccountsReceivableClientId(row.represented_client_id),
                open_invoice_count: 0,
                unpaid_count: 0,
                partial_count: 0,
                overdue_count: 0,
                currencyMap: new Map(),
                rows: [],
            };
            byKey.set(key, acc);
        }
        acc.open_invoice_count += 1;
        if (row.payment_state_key === 'unpaid')
            acc.unpaid_count += 1;
        if (row.payment_state_key === 'partial')
            acc.partial_count += 1;
        if (row.overdue)
            acc.overdue_count += 1;
        acc.rows.push(row);
        const currency = row.currency || 'ILS';
        const cur = acc.currencyMap.get(currency) ?? emptyCurrency(currency);
        cur.original_amount = roundMoney2(cur.original_amount + row.original_amount);
        cur.paid_amount = roundMoney2(cur.paid_amount + row.paid_amount);
        cur.remaining_balance = roundMoney2(cur.remaining_balance + row.remaining_balance);
        if (row.overdue) {
            cur.overdue_remaining_balance = roundMoney2(cur.overdue_remaining_balance + row.remaining_balance);
        }
        acc.currencyMap.set(currency, cur);
    }
    const clients = Array.from(byKey.entries()).map(([key, acc]) => ({
        client_id: acc.client_id,
        client_display_name: displayNameByClientKey.get(key) ?? null,
        open_invoice_count: acc.open_invoice_count,
        unpaid_count: acc.unpaid_count,
        partial_count: acc.partial_count,
        overdue_count: acc.overdue_count,
        totals_by_currency: Array.from(acc.currencyMap.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
        aging: buildAccountsReceivableAgingSummary(acc.rows),
    }));
    return sortAccountsReceivableClients(clients);
}
/** Default stable sort: client_display_name (he), then client_id. No cross-currency debt sort. */
export function sortAccountsReceivableClients(clients) {
    return [...clients].sort((a, b) => {
        const na = (a.client_display_name ?? '').trim();
        const nb = (b.client_display_name ?? '').trim();
        if (na !== nb)
            return na.localeCompare(nb, 'he');
        const ida = a.client_id ?? '';
        const idb = b.client_id ?? '';
        return ida.localeCompare(idb);
    });
}
/** Build display-name map from already-loaded issuer scope labels (zero extra DB). */
export function buildArClientDisplayNameMapFromScope(scope) {
    const map = new Map();
    if (scope.represented_client_id) {
        map.set(accountsReceivableClientGroupKey(scope.represented_client_id), scope.represented_client_label);
    }
    // Self-mode group key (null represented_client_id).
    map.set(accountsReceivableClientGroupKey(null), scope.issuer_label);
    return map;
}

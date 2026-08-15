/**
 * Income client ledger card — display helpers.
 * Invoice remaining / payment amounts come from Accounting Base; this module only formats
 * and groups already-linked invoice + allocation rows.
 */
import { amountReferenceFromTotalsSnapshot } from './income-work-engine-bridge.pure.js';
export const INCOME_LEDGER_FINANCIAL_SOURCE = 'accounting_base';
export function ledgerAmountFromTotalsSnapshot(totals) {
    if (!totals || typeof totals !== 'object')
        return 0;
    const grand = totals.grand_total_reference;
    if (typeof grand === 'number' && Number.isFinite(grand))
        return Math.max(0, grand);
    const ref = amountReferenceFromTotalsSnapshot(totals);
    return ref != null && ref > 0 ? ref : 0;
}
export function formatLedgerMoneyReference(amount, currency) {
    const symbol = currency === 'ILS' ? '₪' : currency;
    const formatted = amount.toLocaleString('he-IL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return `${symbol}${formatted}`;
}
export function formatLedgerIssueDateDisplay(iso) {
    if (!iso)
        return '—';
    const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
    const [y, m, day] = d.split('-');
    if (!y || !m || !day)
        return d;
    return `${day}/${m}/${y}`;
}
export function issueYearFromIso(iso) {
    if (!iso || iso.length < 4)
        return null;
    const y = Number(iso.slice(0, 4));
    return Number.isFinite(y) ? y : null;
}
function compareIsoThenNumber(aDate, bDate, aNum, bNum) {
    const dateCmp = aDate.localeCompare(bDate);
    if (dateCmp !== 0)
        return dateCmp;
    return aNum.localeCompare(bNum, 'he', { numeric: true });
}
export function buildLedgerInvoiceGroups(invoices) {
    const sorted = [...invoices].sort((a, b) => compareIsoThenNumber(a.issue_date, b.issue_date, a.document_number, b.document_number));
    return sorted.map((invoice) => {
        const remaining = invoice.remaining_balance;
        const payments = [...invoice.payments]
            .sort((a, b) => compareIsoThenNumber(a.payment_date, b.payment_date, a.payment_id, b.payment_id))
            .map((payment) => ({
            payment_id: payment.payment_id,
            allocation_id: payment.allocation_id,
            cashbox_display: payment.cashbox_display,
            payment_date_display: formatLedgerIssueDateDisplay(payment.payment_date),
            amount_display: formatLedgerMoneyReference(payment.amount, payment.currency || invoice.currency),
        }));
        return {
            income_document_id: invoice.income_document_id,
            document_type_label: invoice.document_type_label,
            document_number: invoice.document_number,
            issue_date_display: formatLedgerIssueDateDisplay(invoice.issue_date),
            original_amount_display: formatLedgerMoneyReference(invoice.original_amount, invoice.currency),
            remaining_balance_display: formatLedgerMoneyReference(remaining, invoice.currency),
            remaining_balance_tone: remaining > 0.005 ? 'open' : 'zero',
            view_action: invoice.view_action,
            payments,
        };
    });
}
export function flattenLedgerInvoiceGroups(documents) {
    const rows = [];
    for (const doc of documents) {
        rows.push({
            row_id: `invoice:${doc.income_document_id}`,
            row_kind: 'invoice',
            visual_role: 'parent',
            document_type_label: doc.document_type_label,
            document_number: doc.document_number,
            issue_date_display: doc.issue_date_display,
            original_amount_display: doc.original_amount_display,
            remaining_balance_display: doc.remaining_balance_display,
            amount_tone: 'default',
            view_action: doc.view_action,
        });
        for (const payment of doc.payments) {
            rows.push({
                row_id: `payment:${payment.allocation_id}`,
                row_kind: 'payment',
                visual_role: 'child',
                document_type_label: payment.cashbox_display,
                document_number: '',
                issue_date_display: payment.payment_date_display,
                original_amount_display: payment.amount_display,
                remaining_balance_display: '',
                amount_tone: 'payment',
                view_action: null,
            });
        }
    }
    return rows;
}
export function sumLedgerRemainingBalance(invoices) {
    let total = 0;
    for (const invoice of invoices) {
        total += invoice.remaining_balance;
    }
    return Math.round(total * 100) / 100;
}

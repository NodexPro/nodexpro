/**
 * Income client ledger card — display composition only.
 * Debit / credit / remaining / running balance amounts come from Accounting Base;
 * this module formats already-resolved amounts and does not invent financial truth.
 */
import { roundMoney2 } from '../accounting-base/accounting-base-income-payment.pure.js';
import { amountReferenceFromTotalsSnapshot } from './income-work-engine-bridge.pure.js';
import { calendarDateIso, formatIncomeCalendarDateHe, } from './income-document-semantic-dates.pure.js';
export const INCOME_LEDGER_FINANCIAL_SOURCE = 'accounting_base';
export const INCOME_LEDGER_CASHBOX_LABELS = {
    bank_transfer: 'קופת העברות',
    check: 'קופת צ׳קים',
    credit_card: 'קופת כ. אשראי',
    cash: 'קופת מזומן',
    other: 'קופת אחר',
};
export function incomeLedgerCashboxTypeLabel(method) {
    return INCOME_LEDGER_CASHBOX_LABELS[method];
}
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
    return formatIncomeCalendarDateHe(iso);
}
export function issueYearFromIso(iso) {
    const date = calendarDateIso(iso);
    if (!date)
        return null;
    const y = Number(date.slice(0, 4));
    return Number.isFinite(y) ? y : null;
}
export function parseLedgerCalendarDate(raw) {
    return calendarDateIso(raw);
}
function compareLedgerEvents(a, b) {
    const dateCmp = a.transaction_date.localeCompare(b.transaction_date);
    if (dateCmp !== 0)
        return dateCmp;
    const kindRank = (kind) => {
        if (kind === 'invoice')
            return 0;
        if (kind === 'credit_note')
            return 1;
        return 2;
    };
    const kindCmp = kindRank(a.row_kind) - kindRank(b.row_kind);
    if (kindCmp !== 0)
        return kindCmp;
    const aNum = a.document_number ?? a.payment_document_number ?? a.transaction_id;
    const bNum = b.document_number ?? b.payment_document_number ?? b.transaction_id;
    return aNum.localeCompare(bNum, 'he', { numeric: true });
}
function moneyCell(amount, currency) {
    if (amount == null || !Number.isFinite(amount) || amount <= 0)
        return '';
    return formatLedgerMoneyReference(amount, currency);
}
/**
 * Customer-ledger presentation:
 * - Invoice → חובה (positive money string)
 * - Credit Note → חובה with parentheses (reduction display); NOT זכות
 * - Payment → זכות only
 *
 * Financial running balance still treats Credit Note as receivable reduction.
 * Stored CN amounts remain positive; parentheses are display-only.
 */
function formatLedgerDebitDisplay(params) {
    if (!(params.amount > 0))
        return '';
    const money = formatLedgerMoneyReference(params.amount, params.currency);
    return params.isCreditNoteReduction ? `(${money})` : money;
}
export function buildLedgerTransactionRows(params) {
    const sorted = [...params.events].sort(compareLedgerEvents);
    let running = 0;
    let currentBalance = 0;
    const composed = [];
    for (const event of sorted) {
        const debit = event.debit_amount != null && event.debit_amount > 0 ? roundMoney2(event.debit_amount) : 0;
        const credit = event.credit_amount != null && event.credit_amount > 0 ? roundMoney2(event.credit_amount) : 0;
        const isCreditNoteReduction = event.row_kind === 'credit_note';
        // Presentation columns are owned here; receivable math stays separate from column placement.
        if (isCreditNoteReduction) {
            running = roundMoney2(running - debit);
        }
        else {
            running = roundMoney2(running + debit - credit);
        }
        currentBalance = running;
        const viewEnabled = Boolean(event.view_action?.enabled);
        composed.push({
            row_id: `${event.row_kind}:${event.transaction_id}`,
            transaction_id: event.transaction_id,
            row_kind: event.row_kind,
            transaction_date: event.transaction_date,
            transaction_date_display: formatLedgerIssueDateDisplay(event.transaction_date),
            transaction_type_key: event.transaction_type_key,
            transaction_type_label: event.transaction_type_label,
            document_id: event.document_id,
            document_number: event.document_number ?? '',
            source_document_id: event.source_document_id,
            source_document_number: event.source_document_number,
            payment_document_id: event.payment_document_id,
            payment_document_number: event.payment_document_number ?? '',
            debit_amount_display: formatLedgerDebitDisplay({
                amount: debit,
                currency: params.currency,
                isCreditNoteReduction,
            }),
            credit_amount_display: moneyCell(credit > 0 ? credit : null, params.currency),
            // Green tone is payment-only (זכות). Credit Notes stay black in חובה.
            credit_amount_tone: !isCreditNoteReduction && credit > 0 ? 'emphasis' : 'none',
            running_balance_display: formatLedgerMoneyReference(running, params.currency),
            view_action: event.view_action,
            allowed_actions: viewEnabled ? ['open_document'] : [],
            // Net חובה = invoices − Credit Notes; זכות = payments only.
            debit_for_total: isCreditNoteReduction ? -debit : debit,
            credit_for_total: isCreditNoteReduction ? 0 : credit,
        });
    }
    const rows = composed
        .filter((row) => row.transaction_date >= params.fromDate && row.transaction_date <= params.toDate)
        .map(({ debit_for_total: _d, credit_for_total: _c, ...row }) => row);
    let totalDebit = 0;
    let totalCredit = 0;
    for (const row of composed) {
        if (row.transaction_date < params.fromDate || row.transaction_date > params.toDate)
            continue;
        totalDebit = roundMoney2(totalDebit + row.debit_for_total);
        totalCredit = roundMoney2(totalCredit + row.credit_for_total);
    }
    return {
        rows,
        total_debit: totalDebit,
        total_credit: totalCredit,
        current_balance: currentBalance,
    };
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
export function sumLedgerRemainingBalance(invoices) {
    let total = 0;
    for (const invoice of invoices) {
        total += invoice.remaining_balance;
    }
    return roundMoney2(total);
}

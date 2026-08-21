/**
 * Income client ledger card — display composition only.
 * Debit / credit / remaining / running balance amounts come from Accounting Base;
 * this module formats already-resolved amounts and does not invent financial truth.
 */

import { roundMoney2, type IncomeInvoicePaymentMethodKey } from '../accounting-base/accounting-base-income-payment.pure.js';
import { amountReferenceFromTotalsSnapshot } from './income-work-engine-bridge.pure.js';
import {
  calendarDateIso,
  formatIncomeCalendarDateHe,
} from './income-document-semantic-dates.pure.js';
import type { IncomeIssuedDocumentViewAction } from './income.types.js';

export const INCOME_LEDGER_FINANCIAL_SOURCE = 'accounting_base' as const;

export const INCOME_LEDGER_CASHBOX_LABELS: Record<IncomeInvoicePaymentMethodKey, string> = {
  bank_transfer: 'קופת העברות',
  check: 'קופת צ׳קים',
  credit_card: 'קופת כ. אשראי',
  cash: 'קופת מזומן',
  other: 'קופת אחר',
};

export function incomeLedgerCashboxTypeLabel(method: IncomeInvoicePaymentMethodKey): string {
  return INCOME_LEDGER_CASHBOX_LABELS[method];
}

export type LedgerInvoicePaymentInput = {
  payment_id: string;
  allocation_id: string;
  cashbox_display: string;
  payment_date: string;
  amount: number;
  currency: string;
  receipt_document_id: string | null;
  receipt_document_number: string | null;
  view_action: IncomeIssuedDocumentViewAction | null;
};

export type LedgerInvoiceGroupInput = {
  income_document_id: string;
  document_type_label: string;
  document_number: string;
  issue_date: string;
  original_amount: number;
  remaining_balance: number;
  currency: string;
  view_action: IncomeIssuedDocumentViewAction | null;
  payments: LedgerInvoicePaymentInput[];
};

export type IncomeClientIncomeLedgerCardPaymentChild = {
  payment_id: string;
  allocation_id: string;
  cashbox_display: string;
  payment_date_display: string;
  amount_display: string;
};

export type IncomeClientIncomeLedgerCardInvoiceGroup = {
  income_document_id: string;
  document_type_label: string;
  document_number: string;
  issue_date_display: string;
  original_amount_display: string;
  remaining_balance_display: string;
  remaining_balance_tone: 'open' | 'zero';
  view_action: IncomeIssuedDocumentViewAction | null;
  payments: IncomeClientIncomeLedgerCardPaymentChild[];
};

export type LedgerTransactionEventInput = {
  transaction_id: string;
  row_kind: 'invoice' | 'payment' | 'credit_note';
  transaction_date: string;
  transaction_type_key: string;
  transaction_type_label: string;
  document_id: string | null;
  document_number: string | null;
  /** Backend lineage: Credit Note → source tax invoice (null for invoice/payment). */
  source_document_id: string | null;
  source_document_number: string | null;
  payment_document_id: string | null;
  payment_document_number: string | null;
  debit_amount: number | null;
  credit_amount: number | null;
  view_action: IncomeIssuedDocumentViewAction | null;
};

export type IncomeClientIncomeLedgerCardRenderRow = {
  row_id: string;
  transaction_id: string;
  row_kind: 'invoice' | 'payment' | 'credit_note';
  transaction_date: string;
  transaction_date_display: string;
  transaction_type_key: string;
  transaction_type_label: string;
  document_id: string | null;
  document_number: string;
  source_document_id: string | null;
  source_document_number: string | null;
  payment_document_id: string | null;
  payment_document_number: string;
  debit_amount_display: string;
  credit_amount_display: string;
  credit_amount_tone: 'emphasis' | 'none';
  running_balance_display: string;
  view_action: IncomeIssuedDocumentViewAction | null;
  allowed_actions: string[];
};

export function ledgerAmountFromTotalsSnapshot(
  totals: Record<string, unknown> | null | undefined,
): number {
  if (!totals || typeof totals !== 'object') return 0;
  const grand = totals.grand_total_reference;
  if (typeof grand === 'number' && Number.isFinite(grand)) return Math.max(0, grand);
  const ref = amountReferenceFromTotalsSnapshot(totals);
  return ref != null && ref > 0 ? ref : 0;
}

export function formatLedgerMoneyReference(amount: number, currency: string): string {
  const symbol = currency === 'ILS' ? '₪' : currency;
  const formatted = amount.toLocaleString('he-IL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

export function formatLedgerIssueDateDisplay(iso: string | null | undefined): string {
  return formatIncomeCalendarDateHe(iso);
}

export function issueYearFromIso(iso: string | null | undefined): number | null {
  const date = calendarDateIso(iso);
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export function parseLedgerCalendarDate(raw: string | null | undefined): string | null {
  return calendarDateIso(raw);
}

function compareLedgerEvents(a: LedgerTransactionEventInput, b: LedgerTransactionEventInput): number {
  const dateCmp = a.transaction_date.localeCompare(b.transaction_date);
  if (dateCmp !== 0) return dateCmp;
  const kindRank = (kind: LedgerTransactionEventInput['row_kind']): number => {
    if (kind === 'invoice') return 0;
    if (kind === 'credit_note') return 1;
    return 2;
  };
  const kindCmp = kindRank(a.row_kind) - kindRank(b.row_kind);
  if (kindCmp !== 0) return kindCmp;
  const aNum = a.document_number ?? a.payment_document_number ?? a.transaction_id;
  const bNum = b.document_number ?? b.payment_document_number ?? b.transaction_id;
  return aNum.localeCompare(bNum, 'he', { numeric: true });
}

function moneyCell(amount: number | null, currency: string): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return '';
  return formatLedgerMoneyReference(amount, currency);
}

export function buildLedgerTransactionRows(params: {
  events: LedgerTransactionEventInput[];
  currency: string;
  fromDate: string;
  toDate: string;
}): {
  rows: IncomeClientIncomeLedgerCardRenderRow[];
  total_debit: number;
  total_credit: number;
  current_balance: number;
} {
  const sorted = [...params.events].sort(compareLedgerEvents);
  let running = 0;
  let currentBalance = 0;
  const composed: Array<IncomeClientIncomeLedgerCardRenderRow & { debit: number; credit: number }> = [];

  for (const event of sorted) {
    const debit = event.debit_amount != null && event.debit_amount > 0 ? roundMoney2(event.debit_amount) : 0;
    const credit = event.credit_amount != null && event.credit_amount > 0 ? roundMoney2(event.credit_amount) : 0;
    running = roundMoney2(running + debit - credit);
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
      debit_amount_display: moneyCell(debit > 0 ? debit : null, params.currency),
      credit_amount_display: moneyCell(credit > 0 ? credit : null, params.currency),
      credit_amount_tone: credit > 0 ? 'emphasis' : 'none',
      running_balance_display: formatLedgerMoneyReference(running, params.currency),
      view_action: event.view_action,
      allowed_actions: viewEnabled ? ['open_document'] : [],
      debit,
      credit,
    });
  }

  const rows = composed
    .filter((row) => row.transaction_date >= params.fromDate && row.transaction_date <= params.toDate)
    .map(({ debit: _d, credit: _c, ...row }) => row);

  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of composed) {
    if (row.transaction_date < params.fromDate || row.transaction_date > params.toDate) continue;
    totalDebit = roundMoney2(totalDebit + row.debit);
    totalCredit = roundMoney2(totalCredit + row.credit);
  }

  return {
    rows,
    total_debit: totalDebit,
    total_credit: totalCredit,
    current_balance: currentBalance,
  };
}

function compareIsoThenNumber(aDate: string, bDate: string, aNum: string, bNum: string): number {
  const dateCmp = aDate.localeCompare(bDate);
  if (dateCmp !== 0) return dateCmp;
  return aNum.localeCompare(bNum, 'he', { numeric: true });
}

export function buildLedgerInvoiceGroups(
  invoices: LedgerInvoiceGroupInput[],
): IncomeClientIncomeLedgerCardInvoiceGroup[] {
  const sorted = [...invoices].sort((a, b) =>
    compareIsoThenNumber(a.issue_date, b.issue_date, a.document_number, b.document_number),
  );
  return sorted.map((invoice) => {
    const remaining = invoice.remaining_balance;
    const payments = [...invoice.payments]
      .sort((a, b) =>
        compareIsoThenNumber(a.payment_date, b.payment_date, a.payment_id, b.payment_id),
      )
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

export function sumLedgerRemainingBalance(invoices: LedgerInvoiceGroupInput[]): number {
  let total = 0;
  for (const invoice of invoices) {
    total += invoice.remaining_balance;
  }
  return roundMoney2(total);
}

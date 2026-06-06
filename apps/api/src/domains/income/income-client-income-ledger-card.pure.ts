/**
 * Income client ledger card — pure movement / balance helpers.
 * TEMPORARY_ACCOUNTING_BASE_PENDING: amounts derived from document snapshots until AR ledger in Accounting Base.
 */

import { amountReferenceFromTotalsSnapshot } from './income-work-engine-bridge.pure.js';

export const INCOME_LEDGER_FINANCIAL_SOURCE = 'TEMPORARY_ACCOUNTING_BASE_PENDING' as const;

export type IncomeLedgerMovementType = 'invoice' | 'payment' | 'credit';

export type IncomeLedgerMovementInput = {
  row_id: string;
  movement_type: IncomeLedgerMovementType;
  income_label: string;
  debit_reference: number | null;
  credit_reference: number | null;
  document_number: string;
  issue_date: string;
  created_at: string;
  document_id: string | null;
  can_view_document: boolean;
};

export type IncomeLedgerMovementRow = {
  row_id: string;
  movement_type: IncomeLedgerMovementType;
  income_label: string;
  debit_amount_display: string | null;
  credit_amount_display: string | null;
  balance_display: string;
  balance_reference: number;
  balance_tone: 'open' | 'zero' | 'neutral';
  document_number: string;
  issue_date_display: string;
  document_id: string | null;
  can_view_document: boolean;
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

export function formatLedgerCreditDisplay(amount: number, currency: string): string {
  return `(${formatLedgerMoneyReference(amount, currency)})`;
}

export function formatLedgerIssueDateDisplay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

export function issueYearFromIso(iso: string | null | undefined): number | null {
  if (!iso || iso.length < 4) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export function compareLedgerMovements(a: IncomeLedgerMovementInput, b: IncomeLedgerMovementInput): number {
  const dateCmp = a.issue_date.localeCompare(b.issue_date);
  if (dateCmp !== 0) return dateCmp;
  return a.created_at.localeCompare(b.created_at);
}

export function computeLedgerMovementRows(params: {
  movements: IncomeLedgerMovementInput[];
  currency: string;
}): IncomeLedgerMovementRow[] {
  const sorted = [...params.movements].sort(compareLedgerMovements);
  let running = 0;
  const rows: IncomeLedgerMovementRow[] = [];

  for (const m of sorted) {
    if (m.debit_reference != null && m.debit_reference > 0) {
      running += m.debit_reference;
    }
    if (m.credit_reference != null && m.credit_reference > 0) {
      running -= m.credit_reference;
    }
    const balanceRef = Math.round(running * 100) / 100;
    rows.push({
      row_id: m.row_id,
      movement_type: m.movement_type,
      income_label: m.income_label,
      debit_amount_display:
        m.debit_reference != null && m.debit_reference > 0
          ? formatLedgerMoneyReference(m.debit_reference, params.currency)
          : null,
      credit_amount_display:
        m.credit_reference != null && m.credit_reference > 0
          ? formatLedgerCreditDisplay(m.credit_reference, params.currency)
          : null,
      balance_display: formatLedgerMoneyReference(Math.max(0, balanceRef), params.currency),
      balance_reference: balanceRef,
      balance_tone: balanceRef > 0.005 ? 'open' : balanceRef <= 0.005 ? 'zero' : 'neutral',
      document_number: m.document_number,
      issue_date_display: formatLedgerIssueDateDisplay(m.issue_date),
      document_id: m.document_id,
      can_view_document: m.can_view_document,
      allowed_actions: m.can_view_document ? ['view_income_document_pdf'] : [],
    });
  }

  return rows;
}

export function sumLedgerDebitCredit(movements: IncomeLedgerMovementInput[]): {
  total_debit_reference: number;
  total_credit_reference: number;
  open_balance_reference: number;
} {
  let total_debit_reference = 0;
  let total_credit_reference = 0;
  for (const m of movements) {
    if (m.debit_reference != null && m.debit_reference > 0) {
      total_debit_reference += m.debit_reference;
    }
    if (m.credit_reference != null && m.credit_reference > 0) {
      total_credit_reference += m.credit_reference;
    }
  }
  const open_balance_reference =
    Math.round((total_debit_reference - total_credit_reference) * 100) / 100;
  return { total_debit_reference, total_credit_reference, open_balance_reference };
}

export type LedgerEndCustomerSourceRow = {
  id: string;
  display_name: string;
  tax_id: string | null;
  email: string | null;
};

export type LedgerEndCustomerDocStats = {
  movements: IncomeLedgerMovementInput[];
  open_invoice_count: number;
  currency: string;
};

export type LedgerEndCustomerOptionRow = {
  end_customer_id: string;
  display_name: string;
  tax_id: string | null;
  email: string | null;
  open_balance_display: string;
  open_balance_reference: number;
  open_invoice_count: number;
  currency: string;
};

/** All issuer-scoped income customers — not filtered by open balance or tax invoices. */
export function buildLedgerEndCustomerOptions(params: {
  customers: LedgerEndCustomerSourceRow[];
  statsByCustomerId: Map<string, LedgerEndCustomerDocStats>;
  defaultCurrency?: string;
}): LedgerEndCustomerOptionRow[] {
  const defaultCurrency = params.defaultCurrency ?? 'ILS';
  return params.customers
    .map((customer) => {
      const stats = params.statsByCustomerId.get(customer.id);
      const movements = stats?.movements ?? [];
      const { open_balance_reference } = sumLedgerDebitCredit(movements);
      const currency = stats?.currency ?? defaultCurrency;
      return {
        end_customer_id: customer.id,
        display_name: customer.display_name,
        tax_id: customer.tax_id,
        email: customer.email,
        open_balance_display: formatLedgerMoneyReference(
          Math.max(0, open_balance_reference),
          currency,
        ),
        open_balance_reference,
        open_invoice_count: stats?.open_invoice_count ?? 0,
        currency,
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'he'));
}

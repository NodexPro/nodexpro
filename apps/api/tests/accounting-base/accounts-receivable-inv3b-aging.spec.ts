/**
 * INV-3B — A/R aging pure projection + aggregate wiring tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildAccountsReceivableAgingSummary,
  parseArAgingBucketFilter,
  resolveAccountsReceivableAgingBucket,
} from '../../src/domains/accounting-base/accounting-base-accounts-receivable-aging.pure.js';
import {
  buildAccountsReceivableSummary,
  filterAccountsReceivableCandidates,
  isOpenAccountsReceivableRow,
  paginateAccountsReceivable,
  withAccountsReceivableAgingBucket,
  type ArComposedCandidate,
} from '../../src/domains/accounting-base/accounting-base-accounts-receivable.pure.js';
import { composeInvoiceLifecycleDueDimension } from '../../src/domains/income/invoice-lifecycle.pure.js';
import { resolveIncomeInvoicePaymentState } from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const agingSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable-aging.pure.ts'),
  'utf8',
);
const pureSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable.pure.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable.read-model.service.ts'),
  'utf8',
);

const TODAY = '2026-08-07';

function row(
  partial: Partial<ArComposedCandidate> & Pick<ArComposedCandidate, 'income_document_id'>,
): ArComposedCandidate {
  return withAccountsReceivableAgingBucket({
    document_number: '1',
    document_type: 'tax_invoice',
    issue_date: '2026-07-01',
    due_date: '2026-08-20',
    represented_client_id: null,
    customer_id: null,
    customer_display_name: null,
    currency: 'ILS',
    original_amount: 1000,
    paid_amount: 0,
    remaining_balance: 1000,
    payment_state_key: 'unpaid',
    due_state_key: 'not_due',
    overdue: false,
    overdue_since: null,
    days_overdue: null,
    ...partial,
  });
}

const ALL_FILTERS = {
  payment_state: 'all_open' as const,
  overdue: 'all' as const,
  aging_bucket: 'all' as const,
  currency: null,
  due_date_from: null,
  due_date_to: null,
  issue_date_from: null,
  issue_date_to: null,
};

function dueBucket(dueDate: string | null): string {
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate,
    remainingBalance: 100,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  return resolveAccountsReceivableAgingBucket({
    overdue: due.overdue,
    days_overdue: due.days_overdue,
  });
}

test('INV-3B A: due tomorrow → current', () => {
  assert.equal(dueBucket('2026-08-08'), 'current');
});

test('INV-3B B: due today → current', () => {
  assert.equal(dueBucket(TODAY), 'current');
});

test('INV-3B C: 1 day overdue → 1_30', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 1 }), '1_30');
  assert.equal(dueBucket('2026-08-06'), '1_30');
});

test('INV-3B D: 30 days overdue → 1_30', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 30 }), '1_30');
});

test('INV-3B E: 31 days overdue → 31_60', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 31 }), '31_60');
});

test('INV-3B F: 60 days overdue → 31_60', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 60 }), '31_60');
});

test('INV-3B G: 61 days overdue → 61_90', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 61 }), '61_90');
});

test('INV-3B H: 90 days overdue → 61_90', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 90 }), '61_90');
});

test('INV-3B I: 91 days overdue → 90_plus', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 91 }), '90_plus');
});

test('INV-3B J: 365 days overdue → 90_plus', () => {
  assert.equal(resolveAccountsReceivableAgingBucket({ overdue: true, days_overdue: 365 }), '90_plus');
});

test('INV-3B no-due-date → current (INV-2 not_applicable, overdue=false)', () => {
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: null,
    remainingBalance: 100,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  assert.equal(due.state_key, 'not_applicable');
  assert.equal(due.overdue, false);
  assert.equal(
    resolveAccountsReceivableAgingBucket({ overdue: due.overdue, days_overdue: due.days_overdue }),
    'current',
  );
});

test('INV-3B K: partial payment keeps bucket; remaining updates', () => {
  const payment = resolveIncomeInvoicePaymentState(1000, 400);
  const r = row({
    income_document_id: 'p',
    overdue: true,
    days_overdue: 42,
    due_state_key: 'overdue',
    due_date: '2026-06-26',
    paid_amount: payment.paid_amount,
    remaining_balance: payment.remaining_balance,
    payment_state_key: payment.payment_state_key,
  });
  assert.equal(r.aging_bucket_key, '31_60');
  assert.equal(r.remaining_balance, 600);
});

test('INV-3B L: fully paid exits open A/R and aging', () => {
  const payment = resolveIncomeInvoicePaymentState(1000, 1000);
  assert.equal(isOpenAccountsReceivableRow({ remaining_balance: payment.remaining_balance }), false);
  const open = filterAccountsReceivableCandidates(
    [
      row({
        income_document_id: 'paid',
        remaining_balance: 0,
        paid_amount: 1000,
        payment_state_key: 'paid',
        overdue: true,
        days_overdue: 42,
      }),
      row({
        income_document_id: 'open',
        remaining_balance: 600,
        overdue: true,
        days_overdue: 42,
      }),
    ],
    ALL_FILTERS,
  );
  assert.equal(open.length, 1);
  const aging = buildAccountsReceivableAgingSummary(open);
  const totalInvoices = aging.buckets.reduce((s, b) => s + b.invoice_count, 0);
  assert.equal(totalInvoices, 1);
  assert.ok(!open.some((r) => r.income_document_id === 'paid'));
});

test('INV-3B M: ILS + USD remain separate per aging bucket', () => {
  const rows = [
    row({
      income_document_id: 'ils',
      currency: 'ILS',
      remaining_balance: 10000,
      overdue: true,
      days_overdue: 42,
    }),
    row({
      income_document_id: 'usd',
      currency: 'USD',
      remaining_balance: 2000,
      overdue: true,
      days_overdue: 45,
    }),
  ];
  const aging = buildAccountsReceivableAgingSummary(rows);
  const b3160 = aging.buckets.find((b) => b.bucket_key === '31_60');
  assert.equal(b3160?.invoice_count, 2);
  assert.equal(b3160?.totals_by_currency.length, 2);
  assert.equal(b3160?.totals_by_currency.find((t) => t.currency === 'ILS')?.remaining_balance, 10000);
  assert.equal(b3160?.totals_by_currency.find((t) => t.currency === 'USD')?.remaining_balance, 2000);
  assert.doesNotMatch(agingSource, /grand_total|cross.?currency/i);
});

test('INV-3B N/O: aging reconciles to summary counts and currency totals', () => {
  const rows = [
    row({ income_document_id: 'c', overdue: false, days_overdue: null, remaining_balance: 100 }),
    row({
      income_document_id: 'a',
      overdue: true,
      days_overdue: 10,
      remaining_balance: 200,
      currency: 'ILS',
    }),
    row({
      income_document_id: 'b',
      overdue: true,
      days_overdue: 100,
      remaining_balance: 50,
      currency: 'USD',
    }),
  ];
  const summary = buildAccountsReceivableSummary(rows);
  const aging = buildAccountsReceivableAgingSummary(rows);
  assert.equal(
    aging.buckets.reduce((s, b) => s + b.invoice_count, 0),
    summary.open_invoice_count,
  );
  for (const cur of summary.totals_by_currency) {
    const agingSum = aging.buckets.reduce((s, b) => {
      const t = b.totals_by_currency.find((x) => x.currency === cur.currency);
      return s + (t?.remaining_balance ?? 0);
    }, 0);
    assert.equal(agingSum, cur.remaining_balance);
  }
});

test('INV-3B P: aging_bucket filter drives rows / total_count / has_more', () => {
  const rows = [
    row({ income_document_id: 'c', overdue: false }),
    row({ income_document_id: '1', overdue: true, days_overdue: 5 }),
    row({ income_document_id: '2', overdue: true, days_overdue: 40 }),
    row({ income_document_id: '3', overdue: true, days_overdue: 40, document_number: '3b' }),
  ];
  const filtered = filterAccountsReceivableCandidates(rows, {
    ...ALL_FILTERS,
    aging_bucket: '31_60',
  });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((r) => r.aging_bucket_key === '31_60'));
  const page = paginateAccountsReceivable(filtered, 1, 0);
  assert.equal(page.total_count, 2);
  assert.equal(page.has_more, true);
  assert.equal(page.page.length, 1);
  assert.equal(parseArAgingBucketFilter('31_60'), '31_60');
  assert.equal(parseArAgingBucketFilter('nope'), 'all');
});

test('INV-3B Q: every open invoice in exactly one bucket', () => {
  const cases: Array<{ overdue: boolean; days_overdue: number | null }> = [
    { overdue: false, days_overdue: null },
    { overdue: true, days_overdue: 1 },
    { overdue: true, days_overdue: 30 },
    { overdue: true, days_overdue: 31 },
    { overdue: true, days_overdue: 60 },
    { overdue: true, days_overdue: 61 },
    { overdue: true, days_overdue: 90 },
    { overdue: true, days_overdue: 91 },
  ];
  const keys = cases.map((c) => resolveAccountsReceivableAgingBucket(c));
  assert.equal(keys.length, cases.length);
  assert.ok(keys.every((k) => ['current', '1_30', '31_60', '61_90', '90_plus'].includes(k)));
});

test('INV-3B R/S: aging is pure over composed rows — no extra DB / no storage', () => {
  assert.match(serviceSource, /withAccountsReceivableAgingBucket/);
  assert.match(serviceSource, /buildAccountsReceivableAgingSummary/);
  assert.match(serviceSource, /parseArAgingBucketFilter/);
  assert.doesNotMatch(serviceSource, /aging_status|ar_aging_table|storeAging|persistAging/);
  assert.doesNotMatch(agingSource, /supabaseAdmin|from\('|\.select\(/);
  assert.match(pureSource, /resolveAccountsReceivableAgingBucket/);
  assert.match(agingSource, /[Pp]latform reporting convention/);
  assert.match(agingSource, /not Country Pack/);
});

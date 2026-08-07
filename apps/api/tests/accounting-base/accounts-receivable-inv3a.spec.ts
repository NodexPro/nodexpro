/**
 * INV-3A — accounts receivable pure composition tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveIncomeInvoicePaymentState } from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';
import {
  accountsReceivableSupportedDocumentTypes,
  accountsReceivableUnsupportedCollectibleTypes,
  buildAccountsReceivableSummary,
  buildAccountsReceivableTotalsByCurrency,
  clampArPagination,
  filterAccountsReceivableCandidates,
  isOpenAccountsReceivableRow,
  paginateAccountsReceivable,
  sortAccountsReceivableCandidates,
  withAccountsReceivableAgingBucket,
  type ArComposedCandidate,
} from '../../src/domains/accounting-base/accounting-base-accounts-receivable.pure.js';
import { composeInvoiceLifecycleDueDimension } from '../../src/domains/income/invoice-lifecycle.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const pureSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable.pure.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable.read-model.service.ts'),
  'utf8',
);
const routesSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base.routes.ts'),
  'utf8',
);

const TODAY = '2026-08-07';

function row(partial: Partial<ArComposedCandidate> & Pick<ArComposedCandidate, 'income_document_id'>): ArComposedCandidate {
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

test('INV-3A A: unpaid 1000 included as open', () => {
  const payment = resolveIncomeInvoicePaymentState(1000, 0);
  assert.equal(payment.payment_state_key, 'unpaid');
  assert.equal(payment.remaining_balance, 1000);
  assert.equal(isOpenAccountsReceivableRow({ remaining_balance: payment.remaining_balance }), true);
});

test('INV-3A B: partial 400 → remaining 600 included', () => {
  const payment = resolveIncomeInvoicePaymentState(1000, 400);
  assert.equal(payment.payment_state_key, 'partial');
  assert.equal(payment.remaining_balance, 600);
  assert.equal(isOpenAccountsReceivableRow({ remaining_balance: 600 }), true);
});

test('INV-3A C: paid 1000 → remaining 0 excluded from open', () => {
  const payment = resolveIncomeInvoicePaymentState(1000, 1000);
  assert.equal(payment.payment_state_key, 'paid');
  assert.equal(payment.remaining_balance, 0);
  assert.equal(isOpenAccountsReceivableRow({ remaining_balance: 0 }), false);
  const filtered = filterAccountsReceivableCandidates(
    [
      row({ income_document_id: 'a', remaining_balance: 0, payment_state_key: 'paid', paid_amount: 1000 }),
      row({ income_document_id: 'b', remaining_balance: 100 }),
    ],
    ALL_FILTERS,
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.income_document_id, 'b');
});

test('INV-3A D: multi-currency totals never sum across currencies', () => {
  const totals = buildAccountsReceivableTotalsByCurrency([
    row({ income_document_id: '1', currency: 'ILS', remaining_balance: 1000, original_amount: 1000 }),
    row({ income_document_id: '2', currency: 'USD', remaining_balance: 500, original_amount: 500, paid_amount: 0 }),
  ]);
  assert.equal(totals.length, 2);
  const ils = totals.find((t) => t.currency === 'ILS');
  const usd = totals.find((t) => t.currency === 'USD');
  assert.equal(ils?.remaining_balance, 1000);
  assert.equal(usd?.remaining_balance, 500);
  const grand = totals.reduce((s, t) => s + t.remaining_balance, 0);
  assert.equal(grand, 1500); // sum of buckets only for test math — API must not expose this as one field
  assert.doesNotMatch(pureSource, /grand_total|total_receivable[^_]/);
  assert.match(pureSource, /Never sum across currencies/);
});

test('INV-3A E/F/G: overdue composition reuses INV-2', () => {
  const overdue = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    remainingBalance: 100,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  assert.equal(overdue.overdue, true);
  assert.ok((overdue.days_overdue ?? 0) > 0);

  const future = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-08-20',
    remainingBalance: 100,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  assert.equal(future.overdue, false);

  const noDue = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: null,
    remainingBalance: 100,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  assert.equal(noDue.state_key, 'not_applicable');
  assert.equal(noDue.overdue, false);
  assert.match(serviceSource, /composeInvoiceLifecycleDueDimension/);
});

test('INV-3A H/I/J: scope uses issuer + represented_client filters', () => {
  assert.match(serviceSource, /loadActiveIncomeIssuerScope/);
  assert.match(serviceSource, /issuer_business_id/);
  assert.match(serviceSource, /\.is\('represented_client_id', null\)/);
  assert.match(serviceSource, /\.eq\('represented_client_id', scope\.represented_client_id\)/);
});

test('INV-3A K: unsupported collectible types excluded via AB helper', () => {
  assert.deepEqual(accountsReceivableSupportedDocumentTypes(), ['tax_invoice']);
  assert.ok(accountsReceivableUnsupportedCollectibleTypes().includes('deal_invoice'));
  assert.ok(accountsReceivableUnsupportedCollectibleTypes().includes('tax_invoice_receipt'));
  assert.match(pureSource, /isSupportedIncomePaymentDocumentType/);
  assert.match(serviceSource, /accountsReceivableSupportedDocumentTypes/);
});

test('INV-3A L: pagination total_count / has_more', () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    row({ income_document_id: String(i), document_number: String(i) }),
  );
  const sorted = sortAccountsReceivableCandidates(rows);
  const page1 = paginateAccountsReceivable(sorted, 2, 0);
  assert.equal(page1.page.length, 2);
  assert.equal(page1.total_count, 5);
  assert.equal(page1.has_more, true);
  const page3 = paginateAccountsReceivable(sorted, 2, 4);
  assert.equal(page3.page.length, 1);
  assert.equal(page3.has_more, false);
  const { limit, offset } = clampArPagination(999, -1);
  assert.equal(limit, 200);
  assert.equal(offset, 0);
});

test('INV-3A M: filters payment_state / overdue / currency', () => {
  const rows = [
    row({
      income_document_id: 'u',
      payment_state_key: 'unpaid',
      remaining_balance: 100,
      overdue: true,
      due_state_key: 'overdue',
      currency: 'ILS',
    }),
    row({
      income_document_id: 'p',
      payment_state_key: 'partial',
      paid_amount: 40,
      remaining_balance: 60,
      overdue: false,
      currency: 'USD',
    }),
  ];
  const unpaid = filterAccountsReceivableCandidates(rows, {
    ...ALL_FILTERS,
    payment_state: 'unpaid',
  });
  assert.equal(unpaid.length, 1);
  assert.equal(unpaid[0]?.income_document_id, 'u');

  const overdueOnly = filterAccountsReceivableCandidates(rows, {
    ...ALL_FILTERS,
    overdue: 'true',
  });
  assert.equal(overdueOnly.length, 1);

  const usd = filterAccountsReceivableCandidates(rows, {
    ...ALL_FILTERS,
    currency: 'USD',
  });
  assert.equal(usd.length, 1);
  assert.equal(usd[0]?.currency, 'USD');
});

test('INV-3A N/O: no legacy unpaid; batch AB + no N× lifecycle', () => {
  assert.match(serviceSource, /sumPostedAllocationsForIncomeDocuments/);
  assert.match(serviceSource, /resolveIncomeInvoiceOriginalAmount/);
  assert.match(serviceSource, /resolveIncomeInvoicePaymentState/);
  assert.doesNotMatch(serviceSource, /buildInvoiceLifecycleAggregate|buildIncomeInvoicePaymentCaseAggregate/);
  assert.doesNotMatch(serviceSource, /unpaid_amount_reference|TEMPORARY_ACCOUNTING_BASE_PENDING|collection_status/);
  assert.doesNotMatch(serviceSource, /income_client_document_management_panel_stats/);
  assert.match(routesSource, /\/aggregates\/accounts-receivable/);
  assert.match(serviceSource, /financial_source: 'accounting_base'/);
});

test('INV-3A summary counts from filtered open set', () => {
  const summary = buildAccountsReceivableSummary([
    row({ income_document_id: '1', payment_state_key: 'unpaid', overdue: true, due_state_key: 'overdue' }),
    row({
      income_document_id: '2',
      payment_state_key: 'partial',
      paid_amount: 100,
      remaining_balance: 900,
      overdue: false,
    }),
  ]);
  assert.equal(summary.open_invoice_count, 2);
  assert.equal(summary.unpaid_count, 1);
  assert.equal(summary.partial_count, 1);
  assert.equal(summary.overdue_count, 1);
});

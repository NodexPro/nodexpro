/**
 * INV-3C — client outstanding pure grouping + aggregate wiring tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  accountsReceivableClientGroupKey,
  buildAccountsReceivableClients,
  buildArClientDisplayNameMapFromScope,
} from '../../src/domains/accounting-base/accounting-base-accounts-receivable-clients.pure.js';
import { buildAccountsReceivableAgingSummary } from '../../src/domains/accounting-base/accounting-base-accounts-receivable-aging.pure.js';
import {
  buildAccountsReceivableSummary,
  filterAccountsReceivableCandidates,
  paginateAccountsReceivable,
  withAccountsReceivableAgingBucket,
  type ArComposedCandidate,
} from '../../src/domains/accounting-base/accounting-base-accounts-receivable.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const clientsSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable-clients.pure.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable.read-model.service.ts'),
  'utf8',
);

const CLIENT_A = '11111111-1111-1111-1111-111111111111';
const CLIENT_B = '22222222-2222-2222-2222-222222222222';

function row(
  partial: Partial<ArComposedCandidate> & Pick<ArComposedCandidate, 'income_document_id'>,
): ArComposedCandidate {
  return withAccountsReceivableAgingBucket({
    document_number: '1',
    document_type: 'tax_invoice',
    issue_date: '2026-07-01',
    due_date: '2026-08-20',
    represented_client_id: CLIENT_A,
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

function names(...pairs: Array<[string, string | null]>): Map<string, string | null> {
  return new Map(pairs);
}

test('INV-3C A: Client A two open ILS invoices → count/sum', () => {
  const rows = [
    row({ income_document_id: '1', remaining_balance: 400, original_amount: 400 }),
    row({ income_document_id: '2', remaining_balance: 600, original_amount: 600 }),
  ];
  const clients = buildAccountsReceivableClients(
    rows,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'לקוח א']),
  );
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.client_id, CLIENT_A);
  assert.equal(clients[0]?.client_display_name, 'לקוח א');
  assert.equal(clients[0]?.open_invoice_count, 2);
  assert.equal(clients[0]?.totals_by_currency[0]?.remaining_balance, 1000);
});

test('INV-3C B: unpaid + partial counts', () => {
  const rows = [
    row({ income_document_id: 'u', payment_state_key: 'unpaid', remaining_balance: 100 }),
    row({
      income_document_id: 'p',
      payment_state_key: 'partial',
      paid_amount: 40,
      remaining_balance: 60,
      original_amount: 100,
    }),
  ];
  const clients = buildAccountsReceivableClients(
    rows,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'A']),
  );
  assert.equal(clients[0]?.unpaid_count, 1);
  assert.equal(clients[0]?.partial_count, 1);
  assert.equal(clients[0]?.open_invoice_count, 2);
});

test('INV-3C C: overdue_count and overdue_remaining_balance', () => {
  const rows = [
    row({
      income_document_id: 'od',
      overdue: true,
      days_overdue: 10,
      remaining_balance: 250,
      original_amount: 250,
    }),
    row({
      income_document_id: 'cur',
      overdue: false,
      remaining_balance: 100,
      original_amount: 100,
    }),
  ];
  const clients = buildAccountsReceivableClients(
    rows,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'A']),
  );
  assert.equal(clients[0]?.overdue_count, 1);
  assert.equal(clients[0]?.totals_by_currency[0]?.overdue_remaining_balance, 250);
  assert.equal(clients[0]?.totals_by_currency[0]?.remaining_balance, 350);
});

test('INV-3C D: ILS + USD separate per client', () => {
  const rows = [
    row({ income_document_id: 'ils', currency: 'ILS', remaining_balance: 1000, original_amount: 1000 }),
    row({ income_document_id: 'usd', currency: 'USD', remaining_balance: 200, original_amount: 200 }),
  ];
  const clients = buildAccountsReceivableClients(
    rows,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'A']),
  );
  assert.equal(clients[0]?.totals_by_currency.length, 2);
  assert.equal(clients[0]?.totals_by_currency.find((t) => t.currency === 'ILS')?.remaining_balance, 1000);
  assert.equal(clients[0]?.totals_by_currency.find((t) => t.currency === 'USD')?.remaining_balance, 200);
  assert.doesNotMatch(clientsSource, /grand_total|fx|exchange/i);
});

test('INV-3C E: Client A + Client B no mixing', () => {
  const rows = [
    row({ income_document_id: 'a1', represented_client_id: CLIENT_A, remaining_balance: 100 }),
    row({ income_document_id: 'b1', represented_client_id: CLIENT_B, remaining_balance: 999 }),
  ];
  const clients = buildAccountsReceivableClients(
    rows,
    names(
      [accountsReceivableClientGroupKey(CLIENT_A), 'A'],
      [accountsReceivableClientGroupKey(CLIENT_B), 'B'],
    ),
  );
  assert.equal(clients.length, 2);
  const a = clients.find((c) => c.client_id === CLIENT_A);
  const b = clients.find((c) => c.client_id === CLIENT_B);
  assert.equal(a?.open_invoice_count, 1);
  assert.equal(a?.totals_by_currency[0]?.remaining_balance, 100);
  assert.equal(b?.totals_by_currency[0]?.remaining_balance, 999);
});

test('INV-3C F: client aging reconciles to global aging', () => {
  const rows = [
    row({
      income_document_id: 'a1',
      represented_client_id: CLIENT_A,
      overdue: true,
      days_overdue: 40,
      remaining_balance: 100,
    }),
    row({
      income_document_id: 'b1',
      represented_client_id: CLIENT_B,
      overdue: true,
      days_overdue: 45,
      remaining_balance: 50,
      currency: 'USD',
      original_amount: 50,
    }),
    row({
      income_document_id: 'a2',
      represented_client_id: CLIENT_A,
      overdue: false,
      remaining_balance: 20,
      original_amount: 20,
    }),
  ];
  const globalAging = buildAccountsReceivableAgingSummary(rows);
  const clients = buildAccountsReceivableClients(
    rows,
    names(
      [accountsReceivableClientGroupKey(CLIENT_A), 'A'],
      [accountsReceivableClientGroupKey(CLIENT_B), 'B'],
    ),
  );
  for (const bucket of globalAging.buckets) {
    const clientInvoiceSum = clients.reduce((s, c) => {
      const b = c.aging.buckets.find((x) => x.bucket_key === bucket.bucket_key);
      return s + (b?.invoice_count ?? 0);
    }, 0);
    assert.equal(clientInvoiceSum, bucket.invoice_count);
    for (const tot of bucket.totals_by_currency) {
      const sum = clients.reduce((s, c) => {
        const b = c.aging.buckets.find((x) => x.bucket_key === bucket.bucket_key);
        const t = b?.totals_by_currency.find((x) => x.currency === tot.currency);
        return s + (t?.remaining_balance ?? 0);
      }, 0);
      assert.equal(sum, tot.remaining_balance);
    }
  }
});

test('INV-3C G: aging filter reflected in clients[]', () => {
  const rows = [
    row({ income_document_id: 'cur', overdue: false, remaining_balance: 10 }),
    row({
      income_document_id: 'od',
      overdue: true,
      days_overdue: 40,
      remaining_balance: 90,
    }),
  ];
  const filtered = filterAccountsReceivableCandidates(rows, {
    ...ALL_FILTERS,
    aging_bucket: '31_60',
  });
  const clients = buildAccountsReceivableClients(
    filtered,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'A']),
  );
  assert.equal(clients[0]?.open_invoice_count, 1);
  assert.equal(clients[0]?.totals_by_currency[0]?.remaining_balance, 90);
  assert.equal(
    clients[0]?.aging.buckets.find((b) => b.bucket_key === '31_60')?.invoice_count,
    1,
  );
});

test('INV-3C H: clients[] over full filtered set, not page', () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    row({
      income_document_id: String(i),
      document_number: String(i),
      remaining_balance: 100,
      original_amount: 100,
    }),
  );
  const page = paginateAccountsReceivable(rows, 2, 0);
  assert.equal(page.page.length, 2);
  const clientsFromFull = buildAccountsReceivableClients(
    rows,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'A']),
  );
  const clientsFromPage = buildAccountsReceivableClients(
    page.page,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'A']),
  );
  assert.equal(clientsFromFull[0]?.open_invoice_count, 5);
  assert.equal(clientsFromPage[0]?.open_invoice_count, 2);
  assert.match(serviceSource, /buildAccountsReceivableClients\(filtered/);
  assert.match(serviceSource, /paginateAccountsReceivable\(filtered/);
});

test('INV-3C I: paid excluded from clients', () => {
  const open = filterAccountsReceivableCandidates(
    [
      row({
        income_document_id: 'paid',
        remaining_balance: 0,
        paid_amount: 1000,
        payment_state_key: 'paid',
      }),
      row({ income_document_id: 'open', remaining_balance: 50 }),
    ],
    ALL_FILTERS,
  );
  const clients = buildAccountsReceivableClients(
    open,
    names([accountsReceivableClientGroupKey(CLIENT_A), 'A']),
  );
  assert.equal(clients[0]?.open_invoice_count, 1);
  assert.equal(clients[0]?.totals_by_currency[0]?.remaining_balance, 50);
});

test('INV-3C J: Test3/Test4 isolation (A vs B)', () => {
  const rows = [
    row({ income_document_id: 't3', represented_client_id: CLIENT_A, remaining_balance: 10 }),
    row({ income_document_id: 't4', represented_client_id: CLIENT_B, remaining_balance: 20 }),
  ];
  const clients = buildAccountsReceivableClients(
    rows,
    names(
      [accountsReceivableClientGroupKey(CLIENT_A), 'Test3'],
      [accountsReceivableClientGroupKey(CLIENT_B), 'Test4'],
    ),
  );
  assert.equal(clients.find((c) => c.client_display_name === 'Test3')?.totals_by_currency[0]?.remaining_balance, 10);
  assert.equal(clients.find((c) => c.client_display_name === 'Test4')?.totals_by_currency[0]?.remaining_balance, 20);
});

test('INV-3C K: self mode client_id null + issuer_label', () => {
  const rows = [
    row({ income_document_id: 's1', represented_client_id: null, remaining_balance: 300 }),
  ];
  const map = buildArClientDisplayNameMapFromScope({
    acting_mode: 'self',
    represented_client_id: null,
    represented_client_label: null,
    issuer_label: 'העסק שלי',
  });
  const clients = buildAccountsReceivableClients(rows, map);
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.client_id, null);
  assert.equal(clients[0]?.client_display_name, 'העסק שלי');
  assert.equal(accountsReceivableClientGroupKey(null), '__self__');
});

test('INV-3C L: no N+1 client metadata — scope labels only', () => {
  assert.match(serviceSource, /buildArClientDisplayNameMapFromScope/);
  assert.doesNotMatch(serviceSource, /loadClientOperationsCoreClient|loadClientForIssuer/);
  assert.doesNotMatch(clientsSource, /supabaseAdmin|\.from\('/);
});

test('INV-3C M: client sums reconcile to summary', () => {
  const rows = [
    row({
      income_document_id: 'a1',
      represented_client_id: CLIENT_A,
      remaining_balance: 100,
      overdue: true,
      days_overdue: 5,
    }),
    row({
      income_document_id: 'b1',
      represented_client_id: CLIENT_B,
      remaining_balance: 200,
      currency: 'USD',
      original_amount: 200,
    }),
  ];
  const summary = buildAccountsReceivableSummary(rows);
  const clients = buildAccountsReceivableClients(
    rows,
    names(
      [accountsReceivableClientGroupKey(CLIENT_A), 'A'],
      [accountsReceivableClientGroupKey(CLIENT_B), 'B'],
    ),
  );
  assert.equal(
    clients.reduce((s, c) => s + c.open_invoice_count, 0),
    summary.open_invoice_count,
  );
  for (const cur of summary.totals_by_currency) {
    const sum = clients.reduce((s, c) => {
      const t = c.totals_by_currency.find((x) => x.currency === cur.currency);
      return s + (t?.remaining_balance ?? 0);
    }, 0);
    assert.equal(sum, cur.remaining_balance);
  }
  const overdueGlobal = rows
    .filter((r) => r.overdue)
    .reduce((s, r) => s + r.remaining_balance, 0);
  const overdueClients = clients.reduce(
    (s, c) => s + c.totals_by_currency.reduce((ss, t) => ss + t.overdue_remaining_balance, 0),
    0,
  );
  assert.equal(overdueClients, overdueGlobal);
});

test('INV-3C N: no legacy unpaid fields; candidate-cap completeness flag', () => {
  assert.doesNotMatch(serviceSource, /unpaid_amount_reference|TEMPORARY_ACCOUNTING_BASE_PENDING/);
  assert.match(serviceSource, /clients_totals_complete/);
  assert.match(serviceSource, /Candidate load capped/);
  assert.match(clientsSource, /represented_client_id/);
  assert.match(clientsSource, /Not a fake UUID|__self__/);
});

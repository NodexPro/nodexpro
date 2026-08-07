/**
 * INV-3D — office portfolio A/R pure compose + wiring tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildPortfolioAgingFromGrain,
  buildPortfolioClientsFromGrain,
  buildPortfolioSummaryFromGrain,
  resolveAccountsReceivableAgingBucketFromDueDate,
} from '../../src/domains/accounting-base/accounting-base-accounts-receivable-portfolio.pure.js';
import { resolveAccountsReceivableAgingBucket } from '../../src/domains/accounting-base/accounting-base-accounts-receivable-aging.pure.js';
import { composeInvoiceLifecycleDueDimension } from '../../src/domains/income/invoice-lifecycle.pure.js';
import { resolveIncomeInvoiceOriginalAmount } from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';
import type { AccountsReceivablePortfolioGrain } from '../../src/domains/accounting-base/accounting-base-accounts-receivable-portfolio.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const pureSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable-portfolio.pure.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(
    dir,
    '../../src/domains/accounting-base/accounting-base-accounts-receivable-portfolio.read-model.service.ts',
  ),
  'utf8',
);
const routesSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base.routes.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  join(
    dir,
    '../../../../supabase/migrations/153_accounting_base_accounts_receivable_portfolio.sql',
  ),
  'utf8',
);
const arServiceSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable.read-model.service.ts'),
  'utf8',
);

const CLIENT_A = '11111111-1111-1111-1111-111111111111';
const CLIENT_B = '22222222-2222-2222-2222-222222222222';
const TODAY = '2026-08-07';

function grain(
  partial: Partial<AccountsReceivablePortfolioGrain> &
    Pick<AccountsReceivablePortfolioGrain, 'represented_client_id'>,
): AccountsReceivablePortfolioGrain {
  return {
    currency: 'ILS',
    aging_bucket_key: 'current',
    payment_state_key: 'unpaid',
    overdue: false,
    invoice_count: 1,
    original_amount: 100,
    paid_amount: 0,
    remaining_balance: 100,
    overdue_remaining_balance: 0,
    ...partial,
  };
}

test('INV-3D A: Test3 + Test4 both present, no mixing', () => {
  const grains = [
    grain({ represented_client_id: CLIENT_A, remaining_balance: 10, original_amount: 10 }),
    grain({ represented_client_id: CLIENT_B, remaining_balance: 20, original_amount: 20 }),
  ];
  const clients = buildPortfolioClientsFromGrain(
    grains,
    new Map([
      [CLIENT_A, 'Test3'],
      [CLIENT_B, 'Test4'],
    ]),
  );
  assert.equal(clients.length, 2);
  assert.equal(clients.find((c) => c.client_display_name === 'Test3')?.totals_by_currency[0]?.remaining_balance, 10);
  assert.equal(clients.find((c) => c.client_display_name === 'Test4')?.totals_by_currency[0]?.remaining_balance, 20);
});

test('INV-3D B: self docs excluded in SQL scope', () => {
  assert.match(migrationSource, /acting_mode is distinct from 'self'/);
  assert.match(migrationSource, /represented_client_id is not null/);
  assert.match(migrationSource, /office_representative/);
});

test('INV-3D C: Client A ILS + Client B USD separate', () => {
  const grains = [
    grain({ represented_client_id: CLIENT_A, currency: 'ILS', remaining_balance: 1000, original_amount: 1000 }),
    grain({
      represented_client_id: CLIENT_B,
      currency: 'USD',
      remaining_balance: 200,
      original_amount: 200,
    }),
  ];
  const summary = buildPortfolioSummaryFromGrain(grains);
  assert.equal(summary.totals_by_currency.length, 2);
  assert.equal(summary.totals_by_currency.find((t) => t.currency === 'ILS')?.remaining_balance, 1000);
  assert.equal(summary.totals_by_currency.find((t) => t.currency === 'USD')?.remaining_balance, 200);
});

test('INV-3D D: same client ILS + USD separate client totals', () => {
  const grains = [
    grain({ represented_client_id: CLIENT_A, currency: 'ILS', remaining_balance: 100, original_amount: 100 }),
    grain({
      represented_client_id: CLIENT_A,
      currency: 'USD',
      remaining_balance: 50,
      original_amount: 50,
    }),
  ];
  const clients = buildPortfolioClientsFromGrain(grains, new Map([[CLIENT_A, 'A']]));
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.totals_by_currency.length, 2);
});

test('INV-3D E: partial + unpaid counts', () => {
  const grains = [
    grain({
      represented_client_id: CLIENT_A,
      payment_state_key: 'unpaid',
      invoice_count: 2,
      remaining_balance: 200,
      original_amount: 200,
    }),
    grain({
      represented_client_id: CLIENT_A,
      payment_state_key: 'partial',
      invoice_count: 1,
      paid_amount: 40,
      remaining_balance: 60,
      original_amount: 100,
    }),
  ];
  const summary = buildPortfolioSummaryFromGrain(grains);
  assert.equal(summary.open_invoice_count, 3);
  assert.equal(summary.unpaid_count, 2);
  assert.equal(summary.partial_count, 1);
});

test('INV-3D F: paid excluded — SQL remaining > 0 only', () => {
  assert.match(migrationSource, /remaining_balance > 0/);
  assert.match(migrationSource, /status = 'posted'/);
  assert.match(migrationSource, /reversal_of_allocation_id is null/);
});

test('INV-3D G: aging boundaries equal INV-3B', () => {
  const cases: Array<{ due: string | null; expect: string }> = [
    { due: '2026-08-08', expect: 'current' },
    { due: TODAY, expect: 'current' },
    { due: null, expect: 'current' },
    { due: '2026-08-06', expect: '1_30' },
    { due: '2026-07-08', expect: '1_30' }, // 30 days
    { due: '2026-07-07', expect: '31_60' }, // 31
    { due: '2026-06-08', expect: '31_60' }, // 60
    { due: '2026-06-07', expect: '61_90' }, // 61
    { due: '2026-05-09', expect: '61_90' }, // 90
    { due: '2026-05-08', expect: '90_plus' }, // 91
    { due: '2025-08-07', expect: '90_plus' }, // 365
  ];
  for (const c of cases) {
    const sqlLike = resolveAccountsReceivableAgingBucketFromDueDate({
      dueDate: c.due,
      todayIso: TODAY,
    });
    assert.equal(sqlLike, c.expect, `due=${c.due}`);
    const inv2 = composeInvoiceLifecycleDueDimension({
      documentStatus: 'issued',
      documentType: 'tax_invoice',
      dueDate: c.due,
      remainingBalance: 100,
      paymentStateKey: 'unpaid',
      todayIso: TODAY,
    });
    assert.equal(
      resolveAccountsReceivableAgingBucket({
        overdue: inv2.overdue,
        days_overdue: inv2.days_overdue,
      }),
      c.expect,
      `INV-2 path due=${c.due}`,
    );
  }
  assert.match(migrationSource, /accounting_base_ar_aging_bucket_key/);
  assert.match(migrationSource, /'90_plus'/);
});

test('INV-3D H: filtered client — grain compose only includes that client', () => {
  const grains = [
    grain({ represented_client_id: CLIENT_A, remaining_balance: 10, original_amount: 10 }),
  ];
  const summary = buildPortfolioSummaryFromGrain(grains);
  const clients = buildPortfolioClientsFromGrain(grains, new Map([[CLIENT_A, 'A']]));
  assert.equal(summary.open_invoice_count, 1);
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.client_id, CLIENT_A);
  assert.match(serviceSource, /p_represented_client_id/);
});

test('INV-3D I: filtered currency — no other currencies in summary', () => {
  const grains = [
    grain({
      represented_client_id: CLIENT_A,
      currency: 'USD',
      remaining_balance: 5,
      original_amount: 5,
    }),
  ];
  const summary = buildPortfolioSummaryFromGrain(grains);
  assert.deepEqual(
    summary.totals_by_currency.map((t) => t.currency),
    ['USD'],
  );
});

test('INV-3D J: row pagination does not change summary (grain independent of page)', () => {
  const grains = Array.from({ length: 10 }, (_, i) =>
    grain({
      represented_client_id: CLIENT_A,
      invoice_count: 1,
      remaining_balance: 10,
      original_amount: 10,
      aging_bucket_key: i % 2 === 0 ? 'current' : '1_30',
      overdue: i % 2 !== 0,
      overdue_remaining_balance: i % 2 !== 0 ? 10 : 0,
    }),
  );
  const summary = buildPortfolioSummaryFromGrain(grains);
  assert.equal(summary.open_invoice_count, 10);
  assert.match(serviceSource, /ACCOUNTING_BASE_AR_PORTFOLIO_GRAIN_RPC/);
  assert.match(serviceSource, /ACCOUNTING_BASE_AR_PORTFOLIO_ROWS_RPC/);
  assert.match(serviceSource, /Promise\.all/);
});

test('INV-3D K: >2000 candidate — portfolio avoids AR_CANDIDATE_MAX for totals', () => {
  assert.doesNotMatch(serviceSource, /limit\(AR_CANDIDATE_MAX\)|\.limit\(AR_CANDIDATE_MAX\)/);
  assert.match(serviceSource, /clients_totals_complete: true/);
  assert.match(serviceSource, /not AR_CANDIDATE_MAX hydrate/);
  assert.match(migrationSource, /No candidate cap/);
  assert.match(arServiceSource, /AR_CANDIDATE_MAX/); // issuer-scope path still capped
});

test('INV-3D L: no N+1 client lookup — batch .in', () => {
  assert.match(serviceSource, /batchLoadClientDisplayNames/);
  assert.match(serviceSource, /\.in\('id', chunk\)/);
  assert.doesNotMatch(serviceSource, /loadClientOperationsCoreClient|loadClientForIssuer/);
});

test('INV-3D M: no legacy unpaid source', () => {
  assert.doesNotMatch(serviceSource, /unpaid_amount_reference|TEMPORARY_ACCOUNTING_BASE_PENDING/);
  assert.match(serviceSource, /Legacy panel unpaid_reference/);
  assert.doesNotMatch(migrationSource, /unpaid_reference/);
  assert.doesNotMatch(migrationSource, /->>'total_reference'|totals_snapshot_json->>'total_reference'/);
  assert.match(migrationSource, /accounting_base_income_invoice_original_amount/);
  assert.match(migrationSource, /grand_total_reference/);
});

test('INV-3D N: org isolation', () => {
  assert.match(migrationSource, /d\.organization_id = p_organization_id/);
  assert.match(serviceSource, /assertOrgInContext/);
  assert.match(serviceSource, /p_organization_id: orgId/);
  assert.doesNotMatch(serviceSource, /query\.organization_id/);
});

test('INV-3D O: unsupported document types excluded', () => {
  assert.match(migrationSource, /document_type = 'tax_invoice'/);
  assert.doesNotMatch(
    migrationSource.split('portfolio_grain')[1] ?? migrationSource,
    /deal_invoice|tax_invoice_receipt/,
  );
  assert.match(serviceSource, /accountsReceivableUnsupportedCollectibleTypes/);
});

test('INV-3D P: no mixed-currency grand total', () => {
  assert.doesNotMatch(pureSource, /grand_total|portfolio_total/);
  assert.doesNotMatch(serviceSource, /grand_total|portfolio_total/);
  const summary = buildPortfolioSummaryFromGrain([
    grain({ represented_client_id: CLIENT_A, currency: 'ILS', remaining_balance: 100, original_amount: 100 }),
    grain({
      represented_client_id: CLIENT_A,
      currency: 'EUR',
      remaining_balance: 50,
      original_amount: 50,
    }),
  ]);
  assert.equal(summary.totals_by_currency.length, 2);
});

test('INV-3D reconciliation: clients / aging / summary', () => {
  const grains = [
    grain({
      represented_client_id: CLIENT_A,
      currency: 'ILS',
      aging_bucket_key: '31_60',
      overdue: true,
      invoice_count: 2,
      remaining_balance: 300,
      original_amount: 300,
      overdue_remaining_balance: 300,
    }),
    grain({
      represented_client_id: CLIENT_B,
      currency: 'USD',
      aging_bucket_key: 'current',
      overdue: false,
      invoice_count: 1,
      remaining_balance: 40,
      original_amount: 40,
      overdue_remaining_balance: 0,
    }),
  ];
  const summary = buildPortfolioSummaryFromGrain(grains);
  const aging = buildPortfolioAgingFromGrain(grains);
  const clients = buildPortfolioClientsFromGrain(
    grains,
    new Map([
      [CLIENT_A, 'A'],
      [CLIENT_B, 'B'],
    ]),
  );
  assert.equal(
    clients.reduce((s, c) => s + c.open_invoice_count, 0),
    summary.open_invoice_count,
  );
  for (const cur of summary.totals_by_currency) {
    const clientSum = clients.reduce((s, c) => {
      const t = c.totals_by_currency.find((x) => x.currency === cur.currency);
      return s + (t?.remaining_balance ?? 0);
    }, 0);
    assert.equal(clientSum, cur.remaining_balance);
    const agingSum = aging.buckets.reduce((s, b) => {
      const t = b.totals_by_currency.find((x) => x.currency === cur.currency);
      return s + (t?.remaining_balance ?? 0);
    }, 0);
    assert.equal(agingSum, cur.remaining_balance);
  }
  const overdueClients = clients.reduce(
    (s, c) => s + c.totals_by_currency.reduce((ss, t) => ss + t.overdue_remaining_balance, 0),
    0,
  );
  const overdueSummary = summary.totals_by_currency.reduce(
    (s, t) => s + t.overdue_remaining_balance,
    0,
  );
  assert.equal(overdueClients, overdueSummary);
});

test('INV-3D original amount SQL mirrors TS numeric-only keys', () => {
  assert.equal(
    resolveIncomeInvoiceOriginalAmount({ grand_total_reference: 12.3 }),
    12.3,
  );
  assert.equal(resolveIncomeInvoiceOriginalAmount({ amount_reference: '12' as unknown as number }), 0);
  assert.match(migrationSource, /jsonb_typeof\(p_totals -> 'grand_total_reference'\) = 'number'/);
});

test('INV-3D route + permissions', () => {
  assert.match(routesSource, /\/aggregates\/accounts-receivable-portfolio/);
  assert.match(serviceSource, /clients:read or income\.view/);
  assert.match(serviceSource, /ACCOUNTING_BASE_VIEW_PERMISSION/);
  assert.match(migrationSource, /grant execute[\s\S]*service_role/);
});

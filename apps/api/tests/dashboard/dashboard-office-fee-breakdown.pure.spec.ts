import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateFeeBreakdown } from '../../src/domains/dashboard/dashboard-office-fee-breakdown.pure.js';
import {
  projectClientExpectedFee,
  type ClientExpectedFeeResult,
  type DashboardFeeAgreementInput,
  type DashboardFeeClientInput,
  type DashboardFeeLineInput,
} from '../../src/domains/dashboard/dashboard-office-fees.pure.js';

function client(partial: Partial<DashboardFeeClientInput> = {}): DashboardFeeClientInput {
  return {
    id: 'c1',
    display_name: 'לקוח א',
    status: 'active',
    is_archived: false,
    created_at: '2025-01-01T00:00:00.000Z',
    ended_at: null,
    ...partial,
  };
}

function agreement(partial: Partial<DashboardFeeAgreementInput> = {}): DashboardFeeAgreementInput {
  return {
    client_id: 'c1',
    agreement_status: 'active',
    agreement_start_date: '2026-01-01',
    agreement_end_date: null,
    discount_has: false,
    discount_type: null,
    discount_percent: null,
    discount_amount_ils: null,
    ...partial,
  };
}

function line(partial: Partial<DashboardFeeLineInput> = {}): DashboardFeeLineInput {
  return {
    client_id: 'c1',
    agreement_id: 'a1',
    is_active: true,
    charging_type: 'monthly',
    line_kind: 'built_in',
    catalog_code: 'bookkeeping',
    price_ils: 1000,
    vat_mode: 'before_vat',
    quantity: 1,
    currency_code: 'ILS',
    exchange_rate_to_ils: null,
    payslip_count: null,
    unit_price_ils: null,
    line_total_ils: null,
    ...partial,
  };
}

function row(id: string, name: string, extra: Partial<Parameters<typeof projectClientExpectedFee>[0]> = {}): ClientExpectedFeeResult {
  return projectClientExpectedFee({
    client: client({ id, display_name: name }),
    agreement: extra.agreement === undefined ? agreement({ client_id: id }) : extra.agreement,
    lines: extra.lines ?? [line({ client_id: id, agreement_id: 'a1', price_ils: 100 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
    ...extra,
  });
}

test('server-side pagination keeps a full-result count and does not return the whole authorized set', () => {
  const rows = Array.from({ length: 60 }, (_, i) =>
    row(`c${String(i).padStart(2, '0')}`, `Client ${String(i).padStart(2, '0')}`),
  );
  const page1 = paginateFeeBreakdown(rows, { page: 1, page_size: 25, sort: 'display_name' });
  const page3 = paginateFeeBreakdown(rows, { page: 3, page_size: 25, sort: 'display_name' });
  const page50 = paginateFeeBreakdown(rows, { page: 1, page_size: 50 });
  assert.equal(page1.total, 60);
  assert.equal(page1.total_pages, 3);
  assert.equal(page1.rows.length, 25);
  assert.equal(page3.rows.length, 10);
  assert.equal(page50.page_size, 50);
  assert.equal(page50.rows.length, 50);
});

test('search, category filter, needs-configuration filter, and sort are applied before paging', () => {
  const rows = [
    row('a', 'Alpha', { lines: [line({ client_id: 'a', price_ils: 300 })] }),
    row('b', 'Beta', { agreement: null, lines: [] }),
    row('c', 'Gamma', {
      lines: [line({ client_id: 'c', charging_type: 'one_time', price_ils: 9000 })],
    }),
    row('d', 'Delta Zero', { lines: [line({ client_id: 'd', price_ils: 0 })] }),
  ];
  const search = paginateFeeBreakdown(rows, { q: 'bet' });
  assert.equal(search.total, 1);
  assert.equal(search.rows[0]?.client_id, 'b');

  const zeros = paginateFeeBreakdown(rows, { filter: 'configured_zero' });
  assert.equal(zeros.total, 1);
  assert.equal(zeros.rows[0]?.category, 'configured_zero');

  const needs = paginateFeeBreakdown(rows, { filter: 'needs_configuration' });
  assert.deepEqual(needs.rows.map((r) => r.category).sort(), ['configured_zero', 'no_agreement', 'one_time_only']);
  assert.equal(needs.filter, 'fee_attention');

  const sorted = paginateFeeBreakdown(rows, { sort: 'monthly_before_vat', sort_dir: 'desc' });
  assert.equal(sorted.rows[0]?.client_id, 'a');
});

test('out-of-scope clients are excluded from the breakdown total count', () => {
  const rows = [
    row('a', 'Active'),
    projectClientExpectedFee({
      client: client({ id: 'arch', display_name: 'Archived', is_archived: true }),
      agreement: null,
      lines: [],
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      allowUndatedHistorical: true,
      vatRate: 0.18,
    }),
  ];
  const page = paginateFeeBreakdown(rows, {});
  assert.equal(page.total, 1);
  assert.equal(page.rows[0]?.client_id, 'a');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capFeeAttentionPreview,
  isFeeAttentionCategory,
  paginateFeeBreakdown,
  parseFeeBreakdownFilter,
  selectFeeAttentionClients,
} from '../../src/domains/dashboard/dashboard-office-fee-breakdown.pure.js';
import {
  projectClientExpectedFee,
  projectOfficeExpectedFees,
  type DashboardFeeAgreementInput,
  type DashboardFeeClientInput,
  type DashboardFeeLineInput,
} from '../../src/domains/dashboard/dashboard-office-fees.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const providerSrc = readFileSync(
  join(dir, '../../src/domains/dashboard/providers/dashboard-office.provider.ts'),
  'utf8',
);
const routesSrc = readFileSync(join(dir, '../../src/domains/dashboard/dashboard.routes.ts'), 'utf8');

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

function result(id: string, extra: Partial<Parameters<typeof projectClientExpectedFee>[0]> = {}) {
  return projectClientExpectedFee({
    client: client({ id, display_name: id }),
    agreement: extra.agreement === undefined ? agreement({ client_id: id }) : extra.agreement,
    lines: extra.lines ?? [line({ client_id: id, agreement_id: 'a1', price_ils: 100 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
    ...extra,
  });
}

test('attention includes no-agreement and explicit-zero, and keeps other incomplete categories distinct', () => {
  const none = result('none', { agreement: null, lines: [] });
  const zero = result('zero', { lines: [line({ client_id: 'zero', price_ils: 0 })] });
  const positive = result('pos', { lines: [line({ client_id: 'pos', price_ils: 1460 })] });
  const idle = result('idle', { lines: [line({ client_id: 'idle', is_active: false })] });
  const once = result('once', {
    lines: [line({ client_id: 'once', charging_type: 'one_time', price_ils: 9000 })],
  });

  assert.equal(none.category, 'no_agreement');
  assert.equal(zero.category, 'configured_zero');
  assert.equal(positive.category, 'positive_recurring');
  assert.equal(idle.category, 'no_recurring_service');
  assert.equal(once.category, 'one_time_only');

  assert.equal(isFeeAttentionCategory(none.category), true);
  assert.equal(isFeeAttentionCategory(zero.category), true);
  assert.equal(isFeeAttentionCategory(positive.category), false);
  assert.equal(isFeeAttentionCategory(idle.category), true);
  assert.equal(isFeeAttentionCategory(once.category), true);

  const selected = selectFeeAttentionClients([none, zero, positive, idle, once]);
  assert.deepEqual(
    selected.map((r) => r.category).sort(),
    ['configured_zero', 'no_agreement', 'no_recurring_service', 'one_time_only'],
  );
});

test('explicit zero stays in the attention list but contributes exactly ₪0 to expected fees', () => {
  const office = projectOfficeExpectedFees({
    clients: [
      client({ id: 'paid', display_name: 'Paid' }),
      client({ id: 'zero', display_name: 'Zero' }),
      client({ id: 'none', display_name: 'None' }),
    ],
    agreementsByClient: new Map([
      ['paid', [agreement({ client_id: 'paid' })]],
      ['zero', [agreement({ client_id: 'zero' })]],
    ]),
    linesByClient: new Map([
      ['paid', [line({ client_id: 'paid', price_ils: 1460 })]],
      ['zero', [line({ client_id: 'zero', price_ils: 0 })]],
    ]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });

  assert.equal(office.total_monthly_before_vat, 1460);
  assert.equal(office.client_results.find((r) => r.client_id === 'zero')?.monthly_before_vat, 0);
  assert.equal(office.missing.some((m) => m.client_id === 'zero'), false);

  const attention = selectFeeAttentionClients(office.client_results);
  assert.equal(attention.some((r) => r.client_id === 'zero' && r.category === 'configured_zero'), true);
  assert.equal(attention.some((r) => r.client_id === 'none' && r.category === 'no_agreement'), true);
  assert.equal(attention.some((r) => r.client_id === 'paid'), false);
});

test('attention preview is capped at five rows while preserving the full backend count', () => {
  const rows = [
    result('a', { agreement: null, lines: [] }),
    result('b', { lines: [line({ client_id: 'b', price_ils: 0 })] }),
    result('c', { lines: [line({ client_id: 'c', is_active: false })] }),
    result('d', { lines: [line({ client_id: 'd', charging_type: 'one_time', price_ils: 50 })] }),
    result('e', { agreement: null, lines: [] }),
    result('f', { agreement: null, lines: [] }),
    result('paid', { lines: [line({ client_id: 'paid', price_ils: 200 })] }),
  ];
  const attention = selectFeeAttentionClients(rows);
  const preview = capFeeAttentionPreview(attention, 5);
  assert.equal(attention.length, 6);
  assert.equal(preview.total, 6);
  assert.equal(preview.preview.length, 5);
  assert.equal(preview.truncated, true);
  assert.equal(preview.preview.some((r) => r.client_id === 'paid'), false);
});

test('view-all fee_attention filter is server-side and includes zeros without local paging', () => {
  assert.equal(parseFeeBreakdownFilter('fee_attention'), 'fee_attention');
  assert.equal(parseFeeBreakdownFilter('needs_configuration'), 'fee_attention');

  const rows = Array.from({ length: 12 }, (_, i) =>
    result(`n${i}`, { agreement: null, lines: [] }),
  ).concat(
    result('zero', { lines: [line({ client_id: 'zero', price_ils: 0 })] }),
    result('paid', { lines: [line({ client_id: 'paid', price_ils: 800 })] }),
  );
  const page1 = paginateFeeBreakdown(rows, { filter: 'fee_attention', page: 1, page_size: 25 });
  assert.equal(page1.total, 13);
  assert.equal(page1.rows.length, 13);
  assert.equal(page1.rows.some((r) => r.category === 'configured_zero'), true);
  assert.equal(page1.rows.some((r) => r.category === 'positive_recurring'), false);
  assert.equal(page1.filter, 'fee_attention');
});

test('empty attention set is empty only when no incomplete or explicit-zero clients remain', () => {
  const allConfigured = [
    result('p1', { lines: [line({ client_id: 'p1', price_ils: 100 })] }),
    result('p2', { lines: [line({ client_id: 'p2', price_ils: 50 })] }),
  ];
  assert.equal(selectFeeAttentionClients(allConfigured).length, 0);

  const withZero = [
    result('p1', { lines: [line({ client_id: 'p1', price_ils: 100 })] }),
    result('z', { lines: [line({ client_id: 'z', price_ils: 0 })] }),
  ];
  assert.equal(selectFeeAttentionClients(withZero).length, 1);
  assert.equal(selectFeeAttentionClients(withZero)[0]?.category, 'configured_zero');
});

test('out-of-scope clients never enter the fee-attention filter', () => {
  const rows = [
    result('a', { agreement: null, lines: [] }),
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
  assert.equal(selectFeeAttentionClients(rows).length, 1);
  const page = paginateFeeBreakdown(rows, { filter: 'fee_attention' });
  assert.equal(page.total, 1);
  assert.equal(page.rows[0]?.client_id, 'a');
});

test('office overview attention list is org-scoped, RBAC-gated, and reuses the Fees projection', () => {
  assert.match(providerSrc, /selectFeeAttentionClients\(missingSnapshot\.client_results\)/);
  assert.match(providerSrc, /FEE_ATTENTION_PREVIEW_CAP/);
  assert.match(providerSrc, /view_all_filter[\s\S]*fee_attention/);
  assert.match(providerSrc, /authorizedSet/);
  assert.match(providerSrc, /canViewFees/);
  assert.match(providerSrc, /fees_tab\.view/);
  assert.match(providerSrc, /attentionIndicatorHe/);
  assert.doesNotMatch(providerSrc, /MISSING_FEES_LIST_CAP/);
  assert.match(routesSrc, /authMiddleware/);
  assert.match(routesSrc, /requireOrg/);
  assert.match(routesSrc, /requireOfficeAdministration/);
  assert.match(routesSrc, /\/office-fee-breakdown/);
});

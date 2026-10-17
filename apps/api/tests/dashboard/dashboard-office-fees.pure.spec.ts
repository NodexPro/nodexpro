import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReconstructMonthlyExpectedFromFeeHistory,
  feeScheduleBasisForPeriod,
  monthlyEquivalentBeforeVat,
  parseCountryPackVatRate,
  projectClientExpectedFee,
  projectOfficeExpectedFees,
  splitDashboardFeeLineVat,
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

function project(partial: Parameters<typeof projectClientExpectedFee>[0] & { vatRate?: number | null }) {
  return projectClientExpectedFee({
    vatRate: 0.18,
    ...partial,
  });
}

test('monthly / quarterly / yearly / bi-monthly normalize to monthly equivalent before VAT', () => {
  assert.equal(monthlyEquivalentBeforeVat(1000, 'monthly'), 1000);
  assert.equal(monthlyEquivalentBeforeVat(3600, 'quarterly'), 1200);
  assert.equal(monthlyEquivalentBeforeVat(12000, 'yearly'), 1000);
  assert.equal(monthlyEquivalentBeforeVat(2000, 'bi_monthly'), 1000);
  assert.equal(monthlyEquivalentBeforeVat(5000, 'one_time'), 0);
});

test('Country Pack VAT payload parsing and missing payload', () => {
  assert.equal(parseCountryPackVatRate(null), null);
  assert.equal(parseCountryPackVatRate(undefined), null);
  assert.equal(parseCountryPackVatRate({}), null);
  assert.equal(parseCountryPackVatRate({ rate: 18 }), 0.18);
  assert.equal(parseCountryPackVatRate({ percent: 17 }), 0.17);
  assert.equal(parseCountryPackVatRate(0.18), 0.18);
  assert.equal(parseCountryPackVatRate('nope'), null);
});

test('VAT-inclusive conversion uses the supplied Country Pack rate, not a hardcoded 18%', () => {
  const at18 = splitDashboardFeeLineVat(1180, 'incl_vat', 0.18);
  assert.equal(at18.vat_rate_required, false);
  assert.equal(Math.round(at18.base * 100) / 100, 1000);
  const at17 = splitDashboardFeeLineVat(1170, 'incl_vat', 0.17);
  assert.equal(Math.round(at17.base * 100) / 100, 1000);
});

test('VAT-inclusive conversion is unavailable when Country Pack rate is missing', () => {
  const split = splitDashboardFeeLineVat(1180, 'incl_vat', null);
  assert.equal(split.vat_rate_required, true);
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ vat_mode: 'incl_vat', price_ils: 1180 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: null,
  });
  assert.equal(r.vat_rate_required, true);
  assert.equal(r.missing_recurring, false);
  assert.equal(r.monthly_before_vat, 0);
});

test('VAT-exempt and before-VAT lines do not require a Country Pack rate', () => {
  const exempt = splitDashboardFeeLineVat(1000, 'vat_exempt', null);
  assert.equal(exempt.vat_rate_required, false);
  assert.equal(exempt.base, 1000);
  const before = splitDashboardFeeLineVat(1000, 'before_vat', null);
  assert.equal(before.base, 1000);
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ vat_mode: 'vat_exempt' })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: null,
  });
  assert.equal(r.monthly_before_vat, 1000);
  assert.equal(r.vat_rate_required, false);
});

test('one-time charges are excluded from expected monthly revenue', () => {
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ charging_type: 'one_time', price_ils: 9000 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(r.monthly_before_vat, 0);
  assert.equal(r.missing_recurring, true);
});

test('explicit zero recurring fee is configured, not missing', () => {
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ price_ils: 0 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(r.missing_recurring, false);
  assert.equal(r.configured_zero, true);
  assert.equal(r.monthly_before_vat, 0);
});

test('no active recurring line is missing fee', () => {
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ is_active: false })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(r.missing_recurring, true);
});

test('percent and amount discounts apply to monthly equivalent using the fees-tab factor', () => {
  const percent = project({
    client: client(),
    agreement: agreement({ discount_has: true, discount_type: 'percent', discount_percent: 10 }),
    lines: [line({ charging_type: 'quarterly', price_ils: 3600 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(percent.monthly_before_vat, 1080);

  const amount = project({
    client: client(),
    agreement: agreement({ discount_has: true, discount_type: 'amount', discount_amount_ils: 300 }),
    lines: [line({ charging_type: 'quarterly', price_ils: 3600 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(amount.monthly_before_vat, 1100);
});

test('multiple recurring service lines are summed without double-counting the client', () => {
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [
      line({ catalog_code: 'bookkeeping', price_ils: 1000 }),
      line({ catalog_code: 'annual', charging_type: 'yearly', price_ils: 12000 }),
    ],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(r.monthly_before_vat, 2000);
});

test('historical months require agreement dates; undated agreements are not extrapolated', () => {
  const historical = project({
    client: client(),
    agreement: agreement({ agreement_start_date: null, agreement_end_date: null }),
    lines: [line()],
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    allowUndatedHistorical: false,
  });
  assert.equal(historical.established, false);
  assert.equal(historical.monthly_before_vat, 0);

  const current = project({
    client: client(),
    agreement: agreement({ agreement_start_date: null, agreement_end_date: null }),
    lines: [line()],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(current.established, true);
  assert.equal(current.monthly_before_vat, 1000);
});

test('past periods must not use the current fee schedule', () => {
  assert.equal(feeScheduleBasisForPeriod(true), 'current_configuration');
  assert.equal(feeScheduleBasisForPeriod(false), 'historical_unavailable');
});

test('fee price history cannot reconstruct monthly expected amounts', () => {
  const result = canReconstructMonthlyExpectedFromFeeHistory([
    {
      change_reason: 'totals_change',
      service_line_id: null,
      old_price_ils: 800,
      new_price_ils: 1200,
      effective_from: '2026-07-01',
      effective_to: null,
    },
  ]);
  assert.equal(result.reconstructable, false);
  assert.ok(result.missing.includes('charging_type'));
  assert.ok(result.missing.includes('monthly_equivalent'));
  assert.ok(result.missing.includes('closed_effective_to'));
});

test('inactive and archived clients are excluded from expected fees and missing list', () => {
  const office = projectOfficeExpectedFees({
    clients: [
      client({ id: 'active', display_name: 'פעיל' }),
      client({ id: 'inactive', display_name: 'לא פעיל', status: 'inactive' }),
      client({ id: 'archived', display_name: 'ארכיון', is_archived: true }),
    ],
    agreementsByClient: new Map(),
    linesByClient: new Map(),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  assert.equal(office.missing.length, 1);
  assert.equal(office.missing[0]?.client_id, 'active');
  assert.equal(office.total_monthly_before_vat, 0);
});

test('unlike currencies without a stored ILS rate are not silently summed', () => {
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ currency_code: 'USD', exchange_rate_to_ils: null, price_ils: 200 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(r.skipped_fx, true);
  assert.equal(r.monthly_before_vat, 0);
  assert.equal(r.missing_recurring, false);
});

test('office total sums monthly equivalents without double-counting clients', () => {
  const office = projectOfficeExpectedFees({
    clients: [client({ id: 'a' }), client({ id: 'b', display_name: 'ב' })],
    agreementsByClient: new Map([
      ['a', agreement({ client_id: 'a' })],
      ['b', agreement({ client_id: 'b' })],
    ]),
    linesByClient: new Map([
      ['a', [line({ client_id: 'a', charging_type: 'quarterly', price_ils: 3600 })]],
      ['b', [line({ client_id: 'b', charging_type: 'yearly', price_ils: 12000 })]],
    ]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  assert.equal(office.total_monthly_before_vat, 2200);
  assert.equal(office.missing.length, 0);
});

test('incl_vat office total is blocked when Country Pack rate is missing', () => {
  const office = projectOfficeExpectedFees({
    clients: [client()],
    agreementsByClient: new Map([['c1', agreement()]]),
    linesByClient: new Map([['c1', [line({ vat_mode: 'incl_vat', price_ils: 1180 })]]]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: null,
  });
  assert.equal(office.vat_rate_blocked, true);
  assert.equal(office.total_monthly_before_vat, 0);
  assert.equal(office.missing.length, 0);
});

test('projection only sees the authorized client set passed in (no cross-tenant mix)', () => {
  const office = projectOfficeExpectedFees({
    clients: [client({ id: 'tenant-a' })],
    agreementsByClient: new Map([
      ['tenant-a', agreement({ client_id: 'tenant-a' })],
      ['other-tenant', agreement({ client_id: 'other-tenant' })],
    ]),
    linesByClient: new Map([
      ['tenant-a', [line({ client_id: 'tenant-a', price_ils: 400 })]],
      ['other-tenant', [line({ client_id: 'other-tenant', price_ils: 99999 })]],
    ]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  assert.equal(office.total_monthly_before_vat, 400);
  assert.equal(office.client_results.length, 1);
});

test('amount discount of 43 on 1503 monthly uses the fees-tab factor and yields 1460', () => {
  const r = project({
    client: client(),
    agreement: agreement({ discount_has: true, discount_type: 'amount', discount_amount_ils: 43 }),
    lines: [line({ price_ils: 1503 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(r.monthly_before_discount, 1503);
  assert.equal(r.monthly_before_vat, 1460);
  assert.equal(r.discount_applied_monthly, 43);
  assert.equal(r.category, 'positive_recurring');
});

test('discount is applied to the VAT-split base, not the inclusive gross', () => {
  const r = project({
    client: client(),
    agreement: agreement({ discount_has: true, discount_type: 'amount', discount_amount_ils: 43 }),
    lines: [line({ vat_mode: 'incl_vat', price_ils: 1180 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  assert.equal(r.monthly_before_discount, 1000);
  assert.equal(r.monthly_before_vat, 957);
});

test('quantity multiplies the recurring unit price before monthly normalization', () => {
  const r = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ price_ils: 400, quantity: 2 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(r.monthly_before_vat, 800);
});

test('missing agreement, one-time-only, and no recurring service stay distinct categories', () => {
  const none = project({
    client: client(),
    agreement: null,
    lines: [],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(none.category, 'no_agreement');
  assert.equal(none.missing_recurring, true);

  const once = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ charging_type: 'one_time', price_ils: 9000 })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(once.category, 'one_time_only');

  const idle = project({
    client: client(),
    agreement: agreement(),
    lines: [line({ is_active: false })],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
  });
  assert.equal(idle.category, 'no_recurring_service');
});

test('explicit zero remains visible as configured_zero and is not missing', () => {
  const office = projectOfficeExpectedFees({
    clients: [client()],
    agreementsByClient: new Map([['c1', agreement()]]),
    linesByClient: new Map([['c1', [line({ price_ils: 0 })]]]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  assert.equal(office.missing.length, 0);
  assert.equal(office.completeness, 'complete');
  assert.equal(office.client_results[0]?.category, 'configured_zero');
  assert.equal(office.zero_configured_count, 1);
});

test('unavailable FX blocks a complete office total instead of summing a partial amount', () => {
  const office = projectOfficeExpectedFees({
    clients: [client({ id: 'ok' }), client({ id: 'fx', display_name: 'מטבע' })],
    agreementsByClient: new Map([
      ['ok', agreement({ client_id: 'ok' })],
      ['fx', agreement({ client_id: 'fx' })],
    ]),
    linesByClient: new Map([
      ['ok', [line({ client_id: 'ok', price_ils: 1000 })]],
      ['fx', [line({ client_id: 'fx', currency_code: 'USD', exchange_rate_to_ils: null, price_ils: 200 })]],
    ]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  assert.equal(office.completeness, 'incomplete');
  assert.equal(office.total_monthly_before_vat, 0);
  assert.equal(office.skipped_fx_clients, 1);
});

test('duplicate in-force agreements block the complete office total', () => {
  const office = projectOfficeExpectedFees({
    clients: [client()],
    agreementsByClient: new Map([
      [
        'c1',
        [
          agreement({ id: 'a1' }),
          agreement({ id: 'a2', agreement_start_date: '2026-02-01' }),
        ],
      ],
    ]),
    linesByClient: new Map([['c1', [line({ agreement_id: 'a1', price_ils: 1000 })]]]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  assert.equal(office.completeness, 'incomplete');
  assert.equal(office.total_monthly_before_vat, 0);
  assert.equal(office.client_results[0]?.category, 'needs_attention');
});

test('complete office total equals the sum of included client monthly amounts', () => {
  const office = projectOfficeExpectedFees({
    clients: [client({ id: 'a' }), client({ id: 'b', display_name: 'ב' }), client({ id: 'z', display_name: 'אפס' })],
    agreementsByClient: new Map([
      ['a', agreement({ client_id: 'a' })],
      ['b', agreement({ client_id: 'b' })],
      ['z', agreement({ client_id: 'z' })],
    ]),
    linesByClient: new Map([
      ['a', [line({ client_id: 'a', price_ils: 1000 })]],
      ['b', [line({ client_id: 'b', charging_type: 'yearly', price_ils: 12000 })]],
      ['z', [line({ client_id: 'z', price_ils: 0 })]],
    ]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: 0.18,
  });
  const included = office.client_results.filter((r) => r.included_in_complete_total);
  const sum = included.reduce((acc, r) => acc + r.monthly_before_vat, 0);
  assert.equal(office.completeness, 'complete');
  assert.equal(office.total_monthly_before_vat, sum);
  assert.equal(office.total_monthly_before_vat, 2000);
});

test('missing Country Pack VAT rate makes the office total unavailable, not a silent zero of VAT-inclusive lines', () => {
  const office = projectOfficeExpectedFees({
    clients: [client()],
    agreementsByClient: new Map([['c1', agreement()]]),
    linesByClient: new Map([['c1', [line({ vat_mode: 'incl_vat', price_ils: 1180 })]]]),
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    allowUndatedHistorical: true,
    vatRate: null,
  });
  assert.equal(office.completeness, 'unavailable');
  assert.equal(office.vat_rate_blocked, true);
  assert.equal(office.total_monthly_before_vat, 0);
});

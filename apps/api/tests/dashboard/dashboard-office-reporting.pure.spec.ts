import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientAppliesToReportingEntry,
  groupUpcomingReportingObligations,
  isActiveUpcomingReportingEntry,
  reportingTimingStatus,
} from '../../src/domains/dashboard/dashboard-office-reporting.pure.js';
import { REPORTING_OBLIGATION_KEYS } from '../../src/domains/country-pack/reporting-calendar.pure.js';

const monthlyRegular = {
  client_id: 'c-monthly',
  display_name: 'Monthly',
  vat_type: 'yes',
  vat_due_type: 'regular',
  vat_frequency: 'monthly',
  income_tax_deductions_enabled: false,
  income_tax_deductions_frequency: null,
};

const biMonthlyRegular = {
  ...monthlyRegular,
  client_id: 'c-bimonthly',
  display_name: 'Bi-monthly',
  vat_frequency: 'bi_monthly',
};

const detailedVat = {
  ...monthlyRegular,
  client_id: 'c-pcn',
  display_name: 'PCN',
  vat_due_type: 'pcn',
};

const deductionsMonthly = {
  ...monthlyRegular,
  client_id: 'c-ded',
  display_name: 'Deductions',
  vat_type: 'no',
  vat_due_type: 'not_relevant',
  vat_frequency: 'not_relevant',
  income_tax_deductions_enabled: true,
  income_tax_deductions_frequency: 'monthly',
};

const vatEntry = {
  obligation_key: 'vat_regular_income_tax_advances',
  reporting_period_key: '2026-10',
  filing_due_date: '2026-11-15',
};

test('Country Pack calendar keys do not include a fabricated annual-report obligation', () => {
  assert.equal((REPORTING_OBLIGATION_KEYS as readonly string[]).includes('annual_report'), false);
  assert.equal((REPORTING_OBLIGATION_KEYS as readonly string[]).includes('דוח שנתי'), false);
});

test('applicability uses client tax settings and does not assume every client files every report', () => {
  assert.equal(clientAppliesToReportingEntry(monthlyRegular, vatEntry), true);
  assert.equal(clientAppliesToReportingEntry(detailedVat, vatEntry), false);
  assert.equal(
    clientAppliesToReportingEntry(monthlyRegular, {
      obligation_key: 'vat_detailed',
      reporting_period_key: '2026-10',
      filing_due_date: '2026-11-15',
    }),
    false,
  );
  assert.equal(clientAppliesToReportingEntry(detailedVat, {
    obligation_key: 'vat_detailed',
    reporting_period_key: '2026-10',
    filing_due_date: '2026-11-15',
  }), true);
});

test('income-tax deductions apply only when enabled with monthly frequency identity', () => {
  const entry = {
    obligation_key: 'income_tax_deductions',
    reporting_period_key: '2026-10',
    filing_due_date: '2026-11-15',
  };
  assert.equal(clientAppliesToReportingEntry(deductionsMonthly, entry), true);
  assert.equal(
    clientAppliesToReportingEntry(
      { ...deductionsMonthly, income_tax_deductions_frequency: 'bi_monthly' },
      entry,
    ),
    false,
  );
  assert.equal(clientAppliesToReportingEntry(monthlyRegular, entry), false);
});

test('bi-monthly VAT clients attach to even pair-end stored periods only', () => {
  assert.equal(clientAppliesToReportingEntry(biMonthlyRegular, vatEntry), true);
  assert.equal(
    clientAppliesToReportingEntry(biMonthlyRegular, { ...vatEntry, reporting_period_key: '2026-09' }),
    false,
  );
});

test('upcoming groups use stored filing_due_date, skip past dates, and cap at five', () => {
  const groups = groupUpcomingReportingObligations({
    today: '2026-10-18',
    limit: 5,
    clients: [monthlyRegular, deductionsMonthly, detailedVat],
    entries: [
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-09', filing_due_date: '2026-10-17' },
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-10', filing_due_date: '2026-11-15' },
      { obligation_key: 'income_tax_deductions', reporting_period_key: '2026-10', filing_due_date: '2026-11-16' },
      { obligation_key: 'vat_detailed', reporting_period_key: '2026-10', filing_due_date: '2026-11-17' },
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-11', filing_due_date: '2026-12-15' },
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-12', filing_due_date: '2027-01-15' },
      { obligation_key: 'vat_detailed', reporting_period_key: '2026-11', filing_due_date: '2026-12-16' },
      { obligation_key: 'annual_income_tax_report', reporting_period_key: '2026-12', filing_due_date: '2027-05-31' },
    ],
  });
  assert.equal(groups.length, 5);
  assert.equal(groups.some((g) => g.filing_due_date === '2026-10-17'), false);
  assert.equal(groups.some((g) => g.obligation_key === ('annual_income_tax_report' as never)), false);
  assert.deepEqual(
    groups.map((g) => g.filing_due_date),
    ['2026-11-15', '2026-11-16', '2026-11-17', '2026-12-15', '2026-12-16'],
  );
  assert.deepEqual(groups[0]?.client_ids, ['c-monthly']);
  assert.deepEqual(groups[1]?.client_ids, ['c-ded']);
  assert.deepEqual(groups[2]?.client_ids, ['c-pcn']);
});

test('timing status is derived from the stored due date, not from missing Work Engine tasks', () => {
  assert.equal(reportingTimingStatus('2026-10-17', '2026-10-18'), 'overdue');
  assert.equal(reportingTimingStatus('2026-10-18', '2026-10-18'), 'due_today');
  assert.equal(reportingTimingStatus('2026-11-15', '2026-10-18'), 'upcoming');
});

test('reporting client drill-down requires an ACTIVE stored upcoming calendar row', () => {
  const requested = {
    obligation_key: 'vat_regular_income_tax_advances',
    reporting_period_key: '2026-10',
    filing_due_date: '2026-11-15',
  };
  const active = { ...requested, status: 'active' };
  assert.equal(isActiveUpcomingReportingEntry(active, requested, '2026-10-18'), true);
  assert.equal(isActiveUpcomingReportingEntry({ ...active, status: 'draft' }, requested, '2026-10-18'), false);
  assert.equal(isActiveUpcomingReportingEntry({ ...active, status: 'deprecated' }, requested, '2026-10-18'), false);
  assert.equal(
    isActiveUpcomingReportingEntry(active, { ...requested, filing_due_date: '2026-11-16' }, '2026-10-18'),
    false,
  );
  assert.equal(isActiveUpcomingReportingEntry(active, requested, '2026-11-16'), false);
  assert.equal(isActiveUpcomingReportingEntry(null, requested, '2026-10-18'), false);
});

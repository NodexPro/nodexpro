import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDashboardReportingSummaries,
  clientAppliesToReportingEntry,
  groupUpcomingReportingObligations,
  isActiveUpcomingReportingEntry,
  officeControlDeadlineBucket,
  projectDashboardOfficeControlDeadlines,
  reportingTimingStatus,
} from '../../src/domains/dashboard/dashboard-office-reporting.pure.js';
import { REPORTING_OBLIGATION_KEYS } from '../../src/domains/country-pack/reporting-calendar.pure.js';

const monthlyRegular = {
  client_id: 'c-monthly',
  display_name: 'Monthly',
  vat_type: 'yes',
  vat_due_type: 'regular',
  vat_frequency: 'monthly',
  income_tax_advance_enabled: false,
  income_tax_advance_frequency: null,
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

test('income-tax deductions apply when enabled with monthly or even-month bi-monthly identity', () => {
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
    true,
  );
  assert.equal(
    clientAppliesToReportingEntry(
      { ...deductionsMonthly, income_tax_deductions_frequency: 'bi_monthly' },
      { ...entry, reporting_period_key: '2026-09' },
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

test('category summary counts unique clients, 60-day upcoming, overdue, and excludes filed reports', () => {
  const advanceClient = {
    ...monthlyRegular,
    client_id: 'c-adv',
    display_name: 'Advances',
    vat_type: 'no',
    vat_due_type: 'not_relevant',
    vat_frequency: 'not_relevant',
    income_tax_advance_enabled: true,
    income_tax_advance_frequency: 'monthly',
  };
  const summaries = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [monthlyRegular, advanceClient, deductionsMonthly],
    entries: [
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-09', filing_due_date: '2026-10-17' },
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-10', filing_due_date: '2026-11-15' },
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-12', filing_due_date: '2027-01-15' },
      { obligation_key: 'income_tax_deductions', reporting_period_key: '2026-10', filing_due_date: '2026-11-16' },
    ],
    filings: [
      { client_id: 'c-monthly', category_key: 'vat', reporting_period_key: '2026-09' },
    ],
  });
  const vatUpcoming = summaries.upcoming.find((row) => row.category_key === 'vat');
  const vatOverdue = summaries.overdue.find((row) => row.category_key === 'vat');
  const advancesUpcoming = summaries.upcoming.find((row) => row.category_key === 'income_tax_advances');
  const annualUpcoming = summaries.upcoming.find((row) => row.category_key === 'annual_report');
  const overdueKeys = summaries.overdue.map((row) => row.category_key);
  assert.deepEqual(vatUpcoming?.client_ids, ['c-monthly']);
  assert.equal(vatUpcoming?.nearest_filing_due_date, '2026-11-15');
  assert.deepEqual(vatOverdue?.client_ids, []);
  assert.deepEqual(advancesUpcoming?.client_ids, ['c-adv']);
  assert.equal(annualUpcoming?.clients_count, 0);
  assert.equal(annualUpcoming?.nearest_filing_due_date, null);
  assert.equal(overdueKeys.includes('income_tax_deductions'), false);
  assert.equal(summaries.upcoming.some((row) => row.nearest_filing_due_date === '2027-01-15'), false);
});

test('unknown legal due dates are never overdue and one client is not double-counted', () => {
  const summaries = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [monthlyRegular],
    entries: [
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-09', filing_due_date: '2026-10-17' },
      { obligation_key: 'vat_regular_income_tax_advances', reporting_period_key: '2026-08', filing_due_date: 'not-a-date' },
    ],
  });
  const vatOverdue = summaries.overdue.find((row) => row.category_key === 'vat');
  assert.deepEqual(vatOverdue?.client_ids, ['c-monthly']);
  assert.equal(vatOverdue?.clients_count, 1);
});

test('annual and capital office-control dates use Client Operations instances, not calendar legal due dates', () => {
  const calendarOnly = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [monthlyRegular],
    entries: [
      { obligation_key: 'annual_report', reporting_period_key: '2025', filing_due_date: '2026-05-31' },
      { obligation_key: 'capital_declaration', reporting_period_key: '2025', filing_due_date: '2026-10-01' },
    ],
  });
  assert.equal(calendarOnly.upcoming.find((row) => row.category_key === 'annual_report')?.clients_count, 0);
  assert.equal(calendarOnly.overdue.find((row) => row.category_key === 'capital_declaration')?.clients_count, 0);

  const unfiled = projectDashboardOfficeControlDeadlines({
    instances: [
      {
        client_id: 'c-annual',
        category_key: 'annual_report',
        operational_target_date: '2026-10-01',
        status: 'open',
        tax_year: 2025,
      },
      {
        client_id: 'c-capital',
        category_key: 'capital_declaration',
        operational_target_date: '2026-11-01',
        status: 'open',
        instance_id: 'cap-1',
      },
    ],
  });
  const summaries = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [monthlyRegular],
    entries: [
      { obligation_key: 'annual_report', reporting_period_key: '2025', filing_due_date: '2026-05-31' },
    ],
    officeControlDeadlines: unfiled,
  });
  const annualOverdue = summaries.overdue.find((row) => row.category_key === 'annual_report');
  const capitalUpcoming = summaries.upcoming.find((row) => row.category_key === 'capital_declaration');
  assert.deepEqual(annualOverdue?.client_ids, ['c-annual']);
  assert.equal(annualOverdue?.nearest_filing_due_date, '2026-10-01');
  assert.deepEqual(capitalUpcoming?.client_ids, ['c-capital']);
  assert.equal(capitalUpcoming?.nearest_filing_due_date, '2026-11-01');
});

test('office-control missing dates are never overdue and never substituted with a zero deadline', () => {
  assert.equal(officeControlDeadlineBucket(null, '2026-10-18'), null);
  assert.equal(officeControlDeadlineBucket('', '2026-10-18'), null);
  assert.equal(officeControlDeadlineBucket('not-a-date', '2026-10-18'), null);
  assert.equal(officeControlDeadlineBucket('0000-00-00', '2026-10-18'), null);
  const summaries = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [],
    entries: [],
    officeControlDeadlines: projectDashboardOfficeControlDeadlines({
      instances: [
        {
          client_id: 'c-missing',
          category_key: 'annual_report',
          operational_target_date: null,
          status: 'open',
          tax_year: 2025,
        },
        {
          client_id: 'c-blank',
          category_key: 'capital_declaration',
          operational_target_date: '',
          status: 'open',
          instance_id: 'cap-blank',
        },
      ],
    }),
  });
  assert.equal(summaries.overdue.find((row) => row.category_key === 'annual_report')?.clients_count, 0);
  assert.equal(summaries.upcoming.find((row) => row.category_key === 'annual_report')?.clients_count, 0);
  assert.equal(summaries.overdue.find((row) => row.category_key === 'capital_declaration')?.clients_count, 0);
  assert.equal(summaries.upcoming.find((row) => row.category_key === 'capital_declaration')?.clients_count, 0);
});

test('office-control overdue is before today; today and next 60 days are upcoming; day 61 is excluded', () => {
  assert.equal(officeControlDeadlineBucket('2026-10-17', '2026-10-18'), 'overdue');
  assert.equal(officeControlDeadlineBucket('2026-10-18', '2026-10-18'), 'upcoming');
  assert.equal(officeControlDeadlineBucket('2026-12-17', '2026-10-18'), 'upcoming');
  assert.equal(officeControlDeadlineBucket('2026-12-18', '2026-10-18'), null);
  const summaries = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [],
    entries: [],
    officeControlDeadlines: [
      { client_id: 'c-overdue', category_key: 'annual_report', operational_target_date: '2026-10-17', filed: false },
      { client_id: 'c-today', category_key: 'annual_report', operational_target_date: '2026-10-18', filed: false },
      { client_id: 'c-window', category_key: 'annual_report', operational_target_date: '2026-12-17', filed: false },
      { client_id: 'c-later', category_key: 'annual_report', operational_target_date: '2026-12-18', filed: false },
    ],
  });
  assert.deepEqual(summaries.overdue.find((row) => row.category_key === 'annual_report')?.client_ids, ['c-overdue']);
  assert.deepEqual(summaries.upcoming.find((row) => row.category_key === 'annual_report')?.client_ids, [
    'c-today',
    'c-window',
  ]);
});

test('filed office-control reports are excluded from both buckets, including open instances with submitted_on', () => {
  const projected = projectDashboardOfficeControlDeadlines({
    instances: [
      {
        client_id: 'c-completed',
        category_key: 'annual_report',
        operational_target_date: '2026-10-01',
        status: 'completed',
        tax_year: 2024,
      },
      {
        client_id: 'c-submitted',
        category_key: 'annual_report',
        operational_target_date: '2026-11-01',
        status: 'open',
        tax_year: 2025,
      },
      {
        client_id: 'c-capital-filed',
        category_key: 'capital_declaration',
        operational_target_date: '2026-10-01',
        status: 'open',
        instance_id: 'cap-filed',
      },
      {
        client_id: 'c-cancelled',
        category_key: 'annual_report',
        operational_target_date: '2026-10-01',
        status: 'cancelled',
        tax_year: 2023,
      },
    ],
    submissions: [
      {
        client_id: 'c-submitted',
        tab_scope: 'annual_report',
        tax_year: 2025,
        submitted_on: '2026-09-01',
      },
      {
        client_id: 'c-capital-filed',
        tab_scope: 'capital_declaration',
        instance_id: 'cap-filed',
        submitted_on: '2026-09-02',
      },
    ],
  });
  assert.equal(projected.every((row) => row.filed === true || row.client_id === 'c-cancelled'), true);
  const summaries = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [],
    entries: [],
    officeControlDeadlines: projected,
  });
  assert.equal(summaries.overdue.find((row) => row.category_key === 'annual_report')?.clients_count, 0);
  assert.equal(summaries.upcoming.find((row) => row.category_key === 'annual_report')?.clients_count, 0);
  assert.equal(summaries.overdue.find((row) => row.category_key === 'capital_declaration')?.clients_count, 0);
  assert.equal(summaries.upcoming.find((row) => row.category_key === 'capital_declaration')?.clients_count, 0);
});

test('changing an office-control date or filing status recalculates unique clients on the next aggregate', () => {
  const before = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [],
    entries: [],
    officeControlDeadlines: projectDashboardOfficeControlDeadlines({
      instances: [
        {
          client_id: 'c-1',
          category_key: 'annual_report',
          operational_target_date: '2026-10-01',
          status: 'open',
          tax_year: 2025,
        },
        {
          client_id: 'c-1',
          category_key: 'annual_report',
          operational_target_date: '2026-09-01',
          status: 'open',
          tax_year: 2024,
        },
        {
          client_id: 'c-2',
          category_key: 'capital_declaration',
          operational_target_date: '2026-11-01',
          status: 'open',
          instance_id: 'cap-2',
        },
      ],
    }),
  });
  assert.equal(before.overdue.find((row) => row.category_key === 'annual_report')?.clients_count, 1);
  assert.deepEqual(before.overdue.find((row) => row.category_key === 'annual_report')?.client_ids, ['c-1']);
  assert.equal(before.upcoming.find((row) => row.category_key === 'capital_declaration')?.clients_count, 1);
  assert.equal(before.upcoming.find((row) => row.category_key === 'annual_report')?.clients_count, 0);

  const afterDateChange = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [],
    entries: [],
    officeControlDeadlines: projectDashboardOfficeControlDeadlines({
      instances: [
        {
          client_id: 'c-1',
          category_key: 'annual_report',
          operational_target_date: '2026-11-10',
          status: 'open',
          tax_year: 2025,
        },
      ],
    }),
  });
  assert.equal(afterDateChange.overdue.find((row) => row.category_key === 'annual_report')?.clients_count, 0);
  assert.deepEqual(afterDateChange.upcoming.find((row) => row.category_key === 'annual_report')?.client_ids, ['c-1']);

  const afterFiling = buildDashboardReportingSummaries({
    today: '2026-10-18',
    clients: [],
    entries: [],
    officeControlDeadlines: projectDashboardOfficeControlDeadlines({
      instances: [
        {
          client_id: 'c-2',
          category_key: 'capital_declaration',
          operational_target_date: '2026-11-01',
          status: 'completed',
          instance_id: 'cap-2',
        },
      ],
    }),
  });
  assert.equal(afterFiling.upcoming.find((row) => row.category_key === 'capital_declaration')?.clients_count, 0);
  assert.equal(afterFiling.overdue.find((row) => row.category_key === 'capital_declaration')?.clients_count, 0);
});

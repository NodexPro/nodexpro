/**
 * Client Operations reporting dashboard — cell tones, row tones, KPI, priority sort, previous periods.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualAppliesToOperationalPeriod,
  buildPreviousIncompletePeriods,
  buildReportingCellInputFromFacts,
  buildPaymentsOutstandingKpi,
  buildReportingDashboard,
  buildReportingKpiCards,
  buildReportingRowPresentation,
  calendarDaysUntilDue,
  canonicalVatObligationId,
  CLIENT_OPERATIONS_REPORTING_WARNING_DAYS,
  compareReportingPriorityRows,
  formatReportingPeriodDisplayLabel,
  isFilingNotApplicableStatus,
  isFilingSubmittedStatus,
  paymentAppliesForReportingKind,
  resolveReportingCellTone,
  resolveVatCalendarLookupPeriodKey,
  rowMatchesReportingKpiFilter,
  vatBimonthlyObligationMatchesOperationalPeriod,
  type ClientOperationsReportingCellInput,
  type ClientOperationsReportingFilingFact,
} from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';
import { applyRegistryQueryToRows } from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';

const TODAY = '2026-11-15';

function cell(overrides: Partial<ClientOperationsReportingCellInput> & Pick<ClientOperationsReportingCellInput, 'kind'>): ClientOperationsReportingCellInput {
  return {
    applicable: true,
    submitted: false,
    not_applicable_terminal: false,
    due_date: '2026-11-20',
    canonical_id: `${overrides.kind}::2026-10`,
    obligation_id: 'ob-1',
    can_mark_submitted: true,
    can_mark_not_submitted: false,
    last_reported_at: null,
    ...overrides,
  };
}

test('4-day product warning is not a legal due-date change', () => {
  assert.equal(CLIENT_OPERATIONS_REPORTING_WARNING_DAYS, 4);
});

test('calendar day windows: 5+ neutral, 4–2 yellow, 1/today red, past overdue', () => {
  assert.equal(calendarDaysUntilDue('2026-11-20', TODAY), 5);
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: '2026-11-20', today: TODAY }), 'neutral_open');
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: '2026-11-19', today: TODAY }), 'warning');
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: '2026-11-17', today: TODAY }), 'warning');
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: '2026-11-16', today: TODAY }), 'urgent');
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: TODAY, today: TODAY }), 'urgent');
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: '2026-11-14', today: TODAY }), 'overdue');
});

test('submitted / not applicable / unknown are distinct and unknown is not submitted', () => {
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: true, due_date: '2026-11-01', today: TODAY }), 'submitted');
  assert.equal(resolveReportingCellTone({ applicable: false, submitted: false, due_date: '2026-11-16', today: TODAY }), 'not_applicable');
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: null, today: TODAY }), 'unknown');
  assert.equal(isFilingSubmittedStatus('reported'), true);
  assert.equal(isFilingSubmittedStatus('reported_late'), true);
  assert.equal(isFilingSubmittedStatus('paid_on_time'), true);
  assert.equal(isFilingSubmittedStatus('ready_to_report'), false);
  assert.equal(isFilingNotApplicableStatus('not_relevant'), true);
});

test('row is green only when every applicable obligation is submitted and required payment is complete', () => {
  const complete = buildReportingRowPresentation(
    [
      cell({ kind: 'vat', submitted: true, due_date: '2026-11-19', payment_classification: 'paid_in_full' }),
      cell({ kind: 'income_tax_advance', applicable: false, submitted: false }),
    ],
    TODAY,
  );
  assert.equal(complete.row_tone, 'complete');
  const payrollComplete = buildReportingRowPresentation(
    [cell({ kind: 'payroll', submitted: true })],
    TODAY,
  );
  assert.equal(payrollComplete.row_tone, 'complete');
  const filedUnpaid = buildReportingRowPresentation(
    [cell({ kind: 'vat', submitted: true, payment_classification: 'outstanding' })],
    TODAY,
  );
  assert.equal(filedUnpaid.row_tone, 'payment_outstanding');
  assert.equal(filedUnpaid.cells.vat?.submitted, true);
  assert.equal(filedUnpaid.cells.vat?.tone, 'payment_outstanding');
  const open = buildReportingRowPresentation(
    [cell({ kind: 'vat', submitted: false, due_date: '2026-11-20' })],
    TODAY,
  );
  assert.equal(open.row_tone, 'neutral');
  const none = buildReportingRowPresentation(
    [cell({ kind: 'vat', applicable: false, submitted: false })],
    TODAY,
  );
  assert.equal(none.row_tone, 'none');
  const unknownBlocksGreen = buildReportingRowPresentation(
    [cell({ kind: 'vat', submitted: false, due_date: null })],
    TODAY,
  );
  assert.equal(unknownBlocksGreen.row_tone, 'neutral');
});

test('row tone prefers overdue over urgent over warning', () => {
  const row = buildReportingRowPresentation(
    [
      cell({ kind: 'vat', due_date: '2026-11-14' }),
      cell({ kind: 'payroll', due_date: TODAY }),
      cell({ kind: 'income_tax_advance', due_date: '2026-11-18' }),
    ],
    TODAY,
  );
  assert.equal(row.row_tone, 'overdue');
  assert.equal(row.open_overdue_count, 1);
  assert.equal(row.open_urgent_count, 1);
  assert.equal(row.open_warning_count, 1);
});

test('priority sort: overdue, urgent, warning, neutral, complete, then counts / due / name', () => {
  const overdue = {
    client_id: 'c-overdue',
    client_name: 'Beta',
    reporting: buildReportingRowPresentation([cell({ kind: 'vat', due_date: '2026-11-01' })], TODAY),
  };
  const urgent = {
    client_id: 'c-urgent',
    client_name: 'Alpha',
    reporting: buildReportingRowPresentation([cell({ kind: 'vat', due_date: TODAY })], TODAY),
  };
  const complete = {
    client_id: 'c-done',
    client_name: 'Aaa',
    reporting: buildReportingRowPresentation(
      [cell({ kind: 'vat', submitted: true, payment_classification: 'paid_in_full' })],
      TODAY,
    ),
  };
  const ordered = [complete, urgent, overdue].sort(compareReportingPriorityRows);
  assert.deepEqual(
    ordered.map((r) => r.client_id),
    ['c-overdue', 'c-urgent', 'c-done'],
  );
});

test('KPI counts applicable obligations once by canonical id; N/A is excluded', () => {
  const rows = [
    {
      reporting: buildReportingRowPresentation(
        [
          cell({ kind: 'vat', submitted: true, canonical_id: 'vat_report::2026-09-10' }),
          cell({ kind: 'income_tax_advance', applicable: false }),
        ],
        TODAY,
      ),
    },
    {
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: false, canonical_id: 'vat_report::2026-10' })],
        TODAY,
      ),
    },
  ];
  const cards = buildReportingKpiCards(rows);
  const vat = cards.find((c) => c.id === 'vat');
  assert.ok(vat);
  assert.equal(vat.submitted_count, 1);
  assert.equal(vat.total_count, 2);
  assert.equal(vat.remaining_count, 1);
  assert.equal(cards.some((c) => c.id === 'income_tax'), false);
});

test('previous periods count distinct periods, not reports, and split overdue vs incomplete', () => {
  const built = buildPreviousIncompletePeriods({
    selected_period_key: '2026-11',
    facts: [
      { period_key: '2026-08', navigate_period_key: '2026-08', kind: 'month', applicable_incomplete: true, overdue: true },
      { period_key: '2026-08', navigate_period_key: '2026-08', kind: 'month', applicable_incomplete: true, overdue: false },
      { period_key: '2026-09', navigate_period_key: '2026-09', kind: 'month', applicable_incomplete: true, overdue: false },
      { period_key: '2026-10', navigate_period_key: '2026-10', kind: 'month', applicable_incomplete: true, overdue: false },
      { period_key: '2026-12', navigate_period_key: '2026-12', kind: 'month', applicable_incomplete: true, overdue: false },
      { period_key: '2025', navigate_period_key: '2026-05', kind: 'year', applicable_incomplete: true, overdue: true },
    ],
  });
  assert.equal(built.incomplete_count, 4);
  assert.equal(built.overdue_count, 2);
  assert.deepEqual(
    built.periods.map((p) => p.display_label),
    ['2025', '08/26', '09/26', '10/26'],
  );
});

test('annual identity is a year, not 12 monthly debts, and applies only on due month', () => {
  assert.equal(annualAppliesToOperationalPeriod({ due_date: '2026-05-31', operational_period_key: '2026-05' }), true);
  assert.equal(annualAppliesToOperationalPeriod({ due_date: '2026-05-31', operational_period_key: '2026-10' }), false);
  assert.equal(formatReportingPeriodDisplayLabel('2025'), '2025');
});

test('bimonthly VAT matches pair-end month once', () => {
  assert.equal(vatBimonthlyObligationMatchesOperationalPeriod('2026-09-10', '2026-10'), true);
  assert.equal(vatBimonthlyObligationMatchesOperationalPeriod('2026-09-10', '2026-09'), false);
  assert.equal(
    canonicalVatObligationId({
      obligationPeriodKey: '2026-09-10',
      operationalPeriodKey: '2026-10',
      vatFrequency: 'bi_monthly',
    }),
    'vat_report::2026-09-10',
  );
  assert.equal(resolveVatCalendarLookupPeriodKey({ vat_frequency: 'bi_monthly', operational_period_key: '2026-10' }), '2026-10');
  assert.equal(resolveVatCalendarLookupPeriodKey({ vat_frequency: 'bi_monthly', operational_period_key: '2026-09' }), null);
});

test('KPI filter and default priority sort are applied by registry query, not frontend', () => {
  const rows = [
    {
      client_id: 'done',
      client_name: 'Done',
      cells: { vat: 'monthly', client_name: 'Done' },
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: true, payment_classification: 'not_required' })],
        TODAY,
      ),
    },
    {
      client_id: 'open',
      client_name: 'Open',
      cells: { vat: 'monthly', client_name: 'Open' },
      reporting: buildReportingRowPresentation([cell({ kind: 'vat', due_date: '2026-11-01' })], TODAY),
    },
    {
      client_id: 'payroll-only',
      client_name: 'Pay',
      cells: { payroll: 'yes', client_name: 'Pay' },
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', applicable: false }), cell({ kind: 'payroll', due_date: '2026-11-20' })],
        TODAY,
      ),
    },
  ];
  const priority = applyRegistryQueryToRows(rows, { sort_by: 'priority' }).map((r) => r.client_id);
  assert.deepEqual(priority, ['open', 'payroll-only', 'done']);
  const vatOnly = applyRegistryQueryToRows(rows, { sort_by: 'priority', filter_reporting_kpi: 'vat' }).map(
    (r) => r.client_id,
  );
  assert.deepEqual(vatOnly, ['open', 'done']);
  assert.equal(rowMatchesReportingKpiFilter(rows[2]!, 'vat'), false);
  const byName = applyRegistryQueryToRows(rows, { sort_by: 'client_name' }).map((r) => r.client_id);
  assert.deepEqual(byName, ['done', 'open', 'payroll-only']);
  const defaultPriority = applyRegistryQueryToRows(rows, {}).map((r) => r.client_id);
  assert.deepEqual(defaultPriority, ['open', 'payroll-only', 'done']);
});

test('filing fact builder prefers calendar due date and does not invent N/A as submitted', () => {
  const facts: ClientOperationsReportingFilingFact[] = [
    {
      obligation_id: 'ob-vat',
      obligation_type: 'vat_report',
      period_key: '2026-10',
      status: 'ready_to_report',
      due_date: '2026-11-19',
      last_reported_at: null,
    },
  ];
  const built = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    facts,
    calendarDueDate: '2026-11-16',
  });
  assert.equal(built.due_date, '2026-11-16');
  assert.equal(built.submitted, false);
  assert.equal(built.can_mark_submitted, true);
  const na = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    notApplicableOverride: true,
    operationalPeriodKey: '2026-10',
    facts: [{ ...facts[0]!, status: 'not_relevant' }],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(na.applicable, false);
  assert.equal(na.submitted, false);
});

test('dashboard contract echoes sort and kpi filter without inventing empty KPI cards', () => {
  const dashboard = buildReportingDashboard({
    rows: [
      {
        reporting: buildReportingRowPresentation(
          [cell({ kind: 'payroll', submitted: false, due_date: '2026-11-20' })],
          TODAY,
        ),
      },
    ],
    previous_periods: { incomplete_count: 0, overdue_count: 0, periods: [] },
    sort_by: null,
    kpi_filter: null,
  });
  assert.equal(dashboard.active_sort, 'priority');
  assert.equal(dashboard.kpi_cards.length, 1);
  assert.equal(dashboard.kpi_cards[0]?.id, 'payroll');
  assert.equal(dashboard.sort_options[0]?.id, 'priority');
  assert.equal(dashboard.payments_outstanding_kpi.id, 'payments_outstanding');
  assert.equal(dashboard.payments_outstanding_kpi.count, 0);
});

test('filing and payment are independent; unknown payment is not green paid', () => {
  const filedUnknown = buildReportingRowPresentation(
    [cell({ kind: 'vat', submitted: true, can_mark_submitted: false, can_mark_not_submitted: true })],
    TODAY,
  ).cells.vat;
  assert.equal(filedUnknown?.submitted, true);
  assert.equal(filedUnknown?.tone, 'payment_unknown');
  assert.equal(filedUnknown?.display_icon, 'unknown');
  assert.equal(filedUnknown?.payment_due_known, false);
  assert.equal(filedUnknown?.payment_overdue, false);
  assert.equal(filedUnknown?.bank_verified, false);
  assert.equal(filedUnknown?.submitted_indicator, false);
  assert.ok(filedUnknown?.allowed_actions.includes('update_payment'));
  const paid = buildReportingRowPresentation(
    [cell({ kind: 'vat', submitted: true, payment_classification: 'paid_in_full' })],
    TODAY,
  ).cells.vat;
  assert.equal(paid?.tone, 'submitted');
  assert.equal(paid?.display_icon, 'check');
  const partial = buildReportingRowPresentation(
    [cell({ kind: 'vat', submitted: true, payment_classification: 'partially_paid' })],
    TODAY,
  ).cells.vat;
  assert.equal(partial?.tone, 'payment_outstanding');
  assert.equal(partial?.tooltip_key.includes('paymentPartial'), true);
  assert.equal(paymentAppliesForReportingKind('payroll'), false);
  assert.equal(paymentAppliesForReportingKind('vat'), true);
});

test('payments-outstanding KPI counts selected-period orange cells once and lists previous periods in tooltip', () => {
  const rows = [
    {
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: true, canonical_id: 'vat_report::2026-09-10', payment_classification: 'outstanding' })],
        TODAY,
      ),
    },
    {
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: true, canonical_id: 'vat_report::2026-09-10', payment_classification: 'outstanding' })],
        TODAY,
      ),
    },
    {
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'payroll', submitted: true })],
        TODAY,
      ),
    },
  ];
  const kpi = buildPaymentsOutstandingKpi({
    rows,
    selected_period_key: '2026-10',
    outstanding_period_facts: [
      { period_key: '2026-08', canonical_id: 'vat_report::2026-07-08' },
      { period_key: '2026-10', canonical_id: 'vat_report::2026-09-10' },
    ],
  });
  assert.equal(kpi.count, 1);
  assert.deepEqual(
    kpi.tooltip_periods.map((p) => p.period_key),
    ['2026-08', '2026-10'],
  );
  const filtered = applyRegistryQueryToRows(
    [
      {
        client_id: 'orange',
        client_name: 'Orange',
        cells: { vat: 'monthly' },
        reporting: rows[0]!.reporting,
      },
      {
        client_id: 'payroll',
        client_name: 'Pay',
        cells: { payroll: 'yes' },
        reporting: rows[2]!.reporting,
      },
    ],
    { filter_reporting_kpi: 'payments_outstanding', sort_by: 'priority' },
  ).map((r) => r.client_id);
  assert.deepEqual(filtered, ['orange']);
});

test('priority sort places filed-unpaid after unfiled warning and before complete', () => {
  const warning = {
    client_id: 'c-warn',
    client_name: 'Warn',
    reporting: buildReportingRowPresentation([cell({ kind: 'vat', due_date: '2026-11-18' })], TODAY),
  };
  const unpaid = {
    client_id: 'c-unpaid',
    client_name: 'Unpaid',
    reporting: buildReportingRowPresentation(
      [cell({ kind: 'vat', submitted: true, payment_classification: 'outstanding' })],
      TODAY,
    ),
  };
  const done = {
    client_id: 'c-done',
    client_name: 'Done',
    reporting: buildReportingRowPresentation(
      [cell({ kind: 'payroll', submitted: true })],
      TODAY,
    ),
  };
  const ordered = [done, unpaid, warning].sort(compareReportingPriorityRows);
  assert.deepEqual(
    ordered.map((r) => r.client_id),
    ['c-warn', 'c-unpaid', 'c-done'],
  );
});

test('filed VAT still counts as submitted in the filing KPI when payment is outstanding', () => {
  const cards = buildReportingKpiCards([
    {
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: true, payment_classification: 'outstanding' })],
        TODAY,
      ),
    },
  ]);
  const vat = cards.find((c) => c.id === 'vat');
  assert.equal(vat?.submitted_count, 1);
  assert.equal(vat?.remaining_count, 0);
});

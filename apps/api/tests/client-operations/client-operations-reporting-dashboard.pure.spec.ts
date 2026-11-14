/**
 * Client Operations reporting dashboard — cell tones, row tones, KPI, priority sort, previous periods.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annualAppliesToOperationalPeriod,
  buildPreviousIncompletePeriods,
  buildReportingCellInputFromFacts,
  buildReportingCellPresentation,
  buildPaymentsOutstandingKpi,
  buildReportingDashboard,
  buildReportingKpiCards,
  buildReportingRowPresentation,
  nationalInsuranceDeductionsPeriodicSubmitted,
  payrollWorkflowCountsAsSubmitted,
  resolveAnnualReportKpiFact,
  resolveCapitalDeclarationKpiFact,
  calendarDaysUntilDue,
  canonicalVatObligationId,
  CLIENT_OPERATIONS_REPORTING_WARNING_DAYS,
  compareReportingPriorityRows,
  formatReportingPeriodDisplayLabel,
  isFilingNotApplicableStatus,
  isFilingSubmittedStatus,
  paymentAppliesForReportingKind,
  formatReportingCalendarDueDisplay,
  isAuthoritativeLegalOverdue,
  pickObligationForKind,
  pickVatObligationFactForFrequency,
  historicalObligationIdentitiesToPreserve,
  obligationIdentityKey,
  reportingKindIsInformational,
  resolvePreviousPeriodVatCalendarDue,
  resolveReportingCellTone,
  resolveVatCalendarLookupPeriodKey,
  rowMatchesReportingKpiFilter,
  vatBimonthlyObligationMatchesOperationalPeriod,
  vatFilingPeriodIdentityForOperationalPeriod,
  type ClientOperationsReportingCellInput,
  type ClientOperationsReportingFilingFact,
} from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';
import { applyRegistryQueryToRows } from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';
import { resolveAnnualReportTaxYearForOperationalPeriod } from '../../src/domains/client-operations/client-operations-annual-capital-operational.pure.js';

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

test('KPI counts each client once even when VAT canonical_ids collide', () => {
  const rows = [
    {
      client_id: 'c-bi-1',
      reporting: buildReportingRowPresentation(
        [
          cell({ kind: 'vat', submitted: true, canonical_id: 'vat_report::2026-09-10' }),
          cell({ kind: 'income_tax_advance', applicable: false }),
        ],
        TODAY,
      ),
    },
    {
      client_id: 'c-bi-2',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: false, canonical_id: 'vat_report::2026-09-10' })],
        TODAY,
      ),
    },
    {
      client_id: 'c-month',
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
  assert.equal(vat.total_count, 3);
  assert.equal(`${vat.submitted_count}/${vat.total_count}`, '1/3');
  assert.equal(cards.find((c) => c.id === 'income_tax')?.total_count, 0);
});

test('two monthly VAT clients share vat_report::2026-10 identity but count as 2', () => {
  const rows = [
    {
      client_id: 'm1',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: true, canonical_id: 'vat_report::2026-10' })],
        TODAY,
      ),
    },
    {
      client_id: 'm2',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'vat', submitted: false, canonical_id: 'vat_report::2026-10' })],
        TODAY,
      ),
    },
  ];
  const vat = buildReportingKpiCards(rows).find((c) => c.id === 'vat');
  assert.equal(vat?.submitted_count, 1);
  assert.equal(vat?.total_count, 2);
  assert.equal(`${vat?.submitted_count}/${vat?.total_count}`, '1/2');
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
    ['2025', '08.26', '09.26', '10.26'],
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
  assert.equal(formatReportingPeriodDisplayLabel('2026-09-10'), '09.26–10.26');
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

test('dashboard contract echoes sort and kpi filter and always emits seven filing cards', () => {
  const dashboard = buildReportingDashboard({
    rows: [
      {
        client_id: 'c-pay',
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
  assert.deepEqual(
    dashboard.kpi_cards.map((c) => c.id),
    [
      'vat',
      'income_tax',
      'income_tax_deductions',
      'national_insurance_deductions',
      'payroll',
      'annual',
      'capital_declaration',
    ],
  );
  assert.equal(dashboard.kpi_cards.find((c) => c.id === 'payroll')?.total_count, 1);
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
  assert.equal(paymentAppliesForReportingKind('national_insurance'), false);
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

const OCT_TODAY = '2026-11-10';

test('monthly October VAT uses 2026-10 identity and calendar 2026-11-16, not overdue on 10 Nov', () => {
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'monthly', operational_period_key: '2026-10' }),
    { period_key: '2026-10' },
  );
  const built = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'monthly',
    facts: [
      {
        obligation_id: 'ob-vat-oct',
        obligation_type: 'vat_report',
        period_key: '2026-10',
        status: 'ready_to_report',
        due_date: '2026-11-19',
        last_reported_at: null,
      },
    ],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(built.due_date, '2026-11-16');
  assert.equal(built.canonical_id, 'vat_report::2026-10');
  const row = buildReportingRowPresentation([built], OCT_TODAY);
  assert.equal(row.cells.vat?.tone, 'neutral_open');
  assert.equal(row.row_tone, 'neutral');
  assert.equal(row.open_overdue_count, 0);
});

test('bimonthly September–October VAT files on 10.26 with canonical 2026-09-10', () => {
  assert.equal(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'bi_monthly', operational_period_key: '2026-09' }),
    null,
  );
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'bi_monthly', operational_period_key: '2026-10' }),
    { period_key: '2026-09-10' },
  );
  const facts: ClientOperationsReportingFilingFact[] = [
    {
      obligation_id: 'ob-old',
      obligation_type: 'vat_report',
      period_key: '2026-07-08',
      status: 'missing_data',
      due_date: '2026-09-19',
      last_reported_at: null,
    },
    {
      obligation_id: 'ob-current',
      obligation_type: 'vat_report',
      period_key: '2026-09-10',
      status: 'ready_to_report',
      due_date: '2026-11-19',
      last_reported_at: null,
    },
  ];
  const picked = pickObligationForKind(facts, 'vat', '2026-10', 'bi_monthly');
  assert.equal(picked?.obligation_id, 'ob-current');
  assert.equal(pickObligationForKind(facts, 'vat', '2026-09', 'bi_monthly'), null);
  const built = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'bi_monthly',
    facts,
    calendarDueDate: '2026-11-16',
  });
  assert.equal(built.canonical_id, 'vat_report::2026-09-10');
  assert.equal(built.obligation_id, 'ob-current');
  assert.equal(built.can_mark_submitted, true);
});

test('selected-tab row highlighting ignores previous-pair VAT and self-employed NI', () => {
  const row = buildReportingRowPresentation(
    [
      buildReportingCellInputFromFacts({
        kind: 'vat',
        applicable: true,
        operationalPeriodKey: '2026-10',
        vatFrequency: 'bi_monthly',
        facts: [
          {
            obligation_id: 'ob-old',
            obligation_type: 'vat_report',
            period_key: '2026-07-08',
            status: 'missing_data',
            due_date: '2026-09-19',
            last_reported_at: null,
          },
        ],
        calendarDueDate: '2026-11-16',
      }),
      buildReportingCellInputFromFacts({
        kind: 'national_insurance',
        applicable: true,
        operationalPeriodKey: '2026-10',
        facts: [
          {
            obligation_id: 'ob-ni',
            obligation_type: 'national_insurance_self_employed_payment',
            period_key: '2026-10',
            status: 'not_paid',
            due_date: '2026-10-15',
            last_reported_at: null,
          },
        ],
        calendarDueDate: null,
      }),
    ],
    OCT_TODAY,
  );
  assert.equal(row.cells.vat?.tone, 'neutral_open');
  assert.equal(row.cells.national_insurance?.overdue, false);
  assert.equal(row.cells.national_insurance?.overlay_visible, false);
  assert.equal(row.cells.national_insurance?.due_date, null);
  assert.equal(row.row_tone, 'neutral');
  assert.equal(reportingKindIsInformational('national_insurance'), true);
});

test('self-employed NI never drives overdue, row tone, filing KPI or payment overlay', () => {
  const row = buildReportingRowPresentation(
    [
      cell({
        kind: 'national_insurance',
        submitted: false,
        due_date: '2026-10-15',
        payment_classification: 'outstanding',
      }),
    ],
    OCT_TODAY,
  );
  assert.equal(row.row_tone, 'none');
  assert.equal(row.open_overdue_count, 0);
  assert.equal(row.cells.national_insurance?.overdue, false);
  assert.equal(row.cells.national_insurance?.overlay_visible, false);
  assert.equal(row.cells.national_insurance?.allowed_actions.length, 0);
  const cards = buildReportingKpiCards([{ reporting: row }]);
  assert.equal(cards.some((c) => c.id === 'national_insurance'), false);
});

test('unknown legal deadline never becomes overdue; payroll NI deductions stay on selected month', () => {
  assert.equal(isAuthoritativeLegalOverdue(null, OCT_TODAY), false);
  assert.equal(resolveReportingCellTone({ applicable: true, submitted: false, due_date: null, today: OCT_TODAY }), 'unknown');
  const niDed = buildReportingCellInputFromFacts({
    kind: 'national_insurance_deductions',
    applicable: true,
    submittedOverride: false,
    operationalPeriodKey: '2026-10',
    facts: [],
    calendarDueDate: null,
  });
  assert.equal(niDed.canonical_id, 'national_insurance_deductions::2026-10');
  assert.equal(niDed.due_date, null);
  const row = buildReportingRowPresentation([niDed], OCT_TODAY);
  assert.equal(row.cells.national_insurance_deductions?.tone, 'unknown');
  assert.equal(row.cells.national_insurance_deductions?.overdue, false);
  assert.equal(row.row_tone, 'neutral');
  const payroll = buildReportingCellInputFromFacts({
    kind: 'payroll',
    applicable: true,
    operationalPeriodKey: '2026-10',
    facts: [
      {
        obligation_id: 'ob-pay',
        obligation_type: 'payroll_data',
        period_key: '2026-10',
        status: 'missing_data',
        due_date: '2026-10-10',
        last_reported_at: null,
      },
    ],
    calendarDueDate: null,
  });
  assert.equal(payroll.due_date, null);
  assert.equal(buildReportingRowPresentation([payroll], OCT_TODAY).cells.payroll?.tone, 'unknown');
});

test('annual incomplete is not overdue without a calendar due date', () => {
  const built = buildPreviousIncompletePeriods({
    selected_period_key: '2026-10',
    facts: [
      { period_key: '2026', navigate_period_key: '2026-05', kind: 'year', applicable_incomplete: true, overdue: false },
      { period_key: '2026-08', navigate_period_key: '2026-08', kind: 'month', applicable_incomplete: true, overdue: true },
    ],
  });
  assert.equal(built.incomplete_count, 2);
  assert.equal(built.overdue_count, 1);
  const annual = built.periods.find((p) => p.kind === 'year');
  assert.equal(annual?.overdue, false);
  const annualCell = buildReportingCellInputFromFacts({
    kind: 'annual',
    applicable: true,
    operationalPeriodKey: '2026-05',
    facts: [
      {
        obligation_id: 'ob-annual',
        obligation_type: 'annual_report',
        period_key: '2026',
        status: 'ready_to_report',
        due_date: '2026-05-31',
        last_reported_at: null,
      },
    ],
    calendarDueDate: null,
  });
  assert.equal(annualCell.due_date, null);
  assert.equal(buildReportingRowPresentation([annualCell], OCT_TODAY).cells.annual_report?.tone, 'unknown');
});

test('previous-period VAT due uses the client VAT calendar family only', () => {
  const calendar = new Map<string, string>([
    ['vat_regular_income_tax_advances::2026-09', '2026-10-19'],
    ['vat_detailed::2026-09', '2026-10-26'],
  ]);
  assert.equal(
    resolvePreviousPeriodVatCalendarDue({
      vat_frequency: 'monthly',
      vat_type: 'yes',
      vat_due_type: 'regular',
      operational_period_key: '2026-09',
      calendarDueByKey: calendar,
    }),
    '2026-10-19',
  );
  assert.equal(
    resolvePreviousPeriodVatCalendarDue({
      vat_frequency: 'monthly',
      vat_type: 'yes',
      vat_due_type: 'pcn',
      operational_period_key: '2026-09',
      calendarDueByKey: calendar,
    }),
    '2026-10-26',
  );
  assert.equal(
    resolvePreviousPeriodVatCalendarDue({
      vat_frequency: 'monthly',
      vat_type: 'yes',
      vat_due_type: null,
      operational_period_key: '2026-09',
      calendarDueByKey: calendar,
    }),
    null,
  );
});

test('registry VAT due display uses calendar date, never invented 19/23', () => {
  assert.equal(
    formatReportingCalendarDueDisplay({ vat_due_type: 'regular', filing_due_date: '2026-11-16' }),
    '16.11.2026',
  );
  assert.equal(formatReportingCalendarDueDisplay({ vat_due_type: 'pcn', filing_due_date: '2026-11-23' }), 'PCN');
  assert.equal(formatReportingCalendarDueDisplay({ vat_due_type: 'regular', filing_due_date: null }), null);
});

test('obligation due_date fallback is not used for legal overdue', () => {
  const built = buildReportingCellInputFromFacts({
    kind: 'income_tax_advance',
    applicable: true,
    operationalPeriodKey: '2026-10',
    facts: [
      {
        obligation_id: 'ob-ita',
        obligation_type: 'income_tax_advance',
        period_key: '2026-10',
        status: 'missing_data',
        due_date: '2026-10-10',
        last_reported_at: null,
      },
    ],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(built.due_date, '2026-11-16');
  const noCalendar = buildReportingCellInputFromFacts({
    kind: 'income_tax_advance',
    applicable: true,
    operationalPeriodKey: '2026-10',
    facts: [
      {
        obligation_id: 'ob-ita',
        obligation_type: 'income_tax_advance',
        period_key: '2026-10',
        status: 'missing_data',
        due_date: '2026-10-10',
        last_reported_at: null,
      },
    ],
    calendarDueDate: null,
  });
  assert.equal(noCalendar.due_date, null);
});

test('November recompute identity matches tab 10.26; stale Test/Test4 keys cannot confirm filing', () => {
  const previous = '2026-10';
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'monthly', operational_period_key: previous }),
    { period_key: '2026-10' },
  );
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'bi_monthly', operational_period_key: previous }),
    { period_key: '2026-09-10' },
  );

  const staleBimonthly = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'bi_monthly',
    facts: [
      {
        obligation_id: 'ob-test-jul-aug',
        obligation_type: 'vat_report',
        period_key: '2026-07-08',
        status: 'ready_to_report',
        due_date: '2026-09-19',
        last_reported_at: null,
      },
    ],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(staleBimonthly.obligation_id, null);
  assert.equal(staleBimonthly.can_mark_submitted, false);
  assert.equal(staleBimonthly.canonical_id, 'vat_report::2026-09-10');

  const currentBimonthly = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'bi_monthly',
    facts: [
      {
        obligation_id: 'ob-test-sep-oct',
        obligation_type: 'vat_report',
        period_key: '2026-09-10',
        status: 'ready_to_report',
        due_date: '2026-11-19',
        last_reported_at: null,
      },
    ],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(currentBimonthly.obligation_id, 'ob-test-sep-oct');
  assert.equal(currentBimonthly.can_mark_submitted, true);

  const staleMonthly = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'monthly',
    facts: [
      {
        obligation_id: 'ob-test4-sep',
        obligation_type: 'vat_report',
        period_key: '2026-09',
        status: 'ready_to_report',
        due_date: '2026-10-19',
        last_reported_at: null,
      },
    ],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(staleMonthly.obligation_id, null);
  assert.equal(staleMonthly.can_mark_submitted, false);
  assert.equal(staleMonthly.canonical_id, 'vat_report::2026-10');

  const missingMaterial = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'monthly',
    facts: [
      {
        obligation_id: 'ob-test4-oct',
        obligation_type: 'vat_report',
        period_key: '2026-10',
        status: 'missing_data',
        due_date: '2026-11-16',
        last_reported_at: null,
      },
    ],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(missingMaterial.obligation_id, 'ob-test4-oct');
  assert.equal(missingMaterial.can_mark_submitted, true);
  assert.equal(missingMaterial.material_warning, true);
  const missingDetail = buildReportingCellPresentation(missingMaterial, '2026-11-14').filing_detail;
  assert.equal(missingDetail?.can_report, true);
  assert.equal(missingDetail?.material_warning_key, 'clientOperations.registry.reporting.filing.materialWarning');
  assert.equal(missingDetail?.period_display, '10.26');
});

test('legacy UTC bimonthly helper in October kept Jul–Aug; operational October is Sep–Oct', () => {
  function legacyUtcBimonthly(now: Date): string {
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1;
    const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
    const prevYear = curMonth === 1 ? curYear - 1 : curYear;
    const endMonth = prevMonth % 2 === 0 ? prevMonth : prevMonth === 1 ? 12 : prevMonth - 1;
    const endYear = prevMonth % 2 === 0 ? prevYear : prevMonth === 1 ? prevYear - 1 : prevYear;
    const startMonth = endMonth === 1 ? 12 : endMonth - 1;
    const startYear = endMonth === 1 ? endYear - 1 : endYear;
    return `${startYear}-${String(startMonth).padStart(2, '0')}-${String(endMonth).padStart(2, '0')}`;
  }
  assert.equal(legacyUtcBimonthly(new Date('2026-10-15T12:00:00Z')), '2026-07-08');
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'bi_monthly', operational_period_key: '2026-10' }),
    { period_key: '2026-09-10' },
  );
});

test('historical previous-period overdue KPI does not change selected-tab row tone', () => {
  const row = buildReportingRowPresentation(
    [
      buildReportingCellInputFromFacts({
        kind: 'vat',
        applicable: true,
        operationalPeriodKey: '2026-10',
        vatFrequency: 'monthly',
        facts: [
          {
            obligation_id: 'ob-oct',
            obligation_type: 'vat_report',
            period_key: '2026-10',
            status: 'ready_to_report',
            due_date: '2026-11-16',
            last_reported_at: null,
          },
        ],
        calendarDueDate: '2026-11-16',
      }),
    ],
    OCT_TODAY,
  );
  const previous = buildPreviousIncompletePeriods({
    selected_period_key: '2026-10',
    facts: [
      { period_key: '2026-08', navigate_period_key: '2026-08', kind: 'month', applicable_incomplete: true, overdue: true },
      { period_key: '2026-09', navigate_period_key: '2026-09', kind: 'month', applicable_incomplete: true, overdue: true },
      { period_key: '2026', navigate_period_key: '2026-05', kind: 'year', applicable_incomplete: true, overdue: false },
    ],
  });
  assert.equal(previous.overdue_count, 2);
  assert.equal(row.row_tone, 'neutral');
  assert.equal(row.open_overdue_count, 0);
});

test('monthly and bimonthly VAT identities never collide for the selected tab', () => {
  const mixed: ClientOperationsReportingFilingFact[] = [
    {
      obligation_id: 'ob-bimonthly',
      obligation_type: 'vat_report',
      period_key: '2026-09-10',
      status: 'missing_data',
      due_date: '2026-11-16',
      last_reported_at: null,
    },
    {
      obligation_id: 'ob-monthly',
      obligation_type: 'vat_report',
      period_key: '2026-10',
      status: 'ready_to_report',
      due_date: '2026-11-16',
      last_reported_at: null,
    },
  ];
  assert.equal(pickVatObligationFactForFrequency(mixed, '2026-10', 'monthly')?.obligation_id, 'ob-monthly');
  assert.equal(pickVatObligationFactForFrequency(mixed, '2026-10', 'bi_monthly')?.obligation_id, 'ob-bimonthly');
  const monthlyCell = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'monthly',
    facts: mixed,
    calendarDueDate: '2026-11-16',
  });
  assert.equal(monthlyCell.obligation_id, 'ob-monthly');
  assert.equal(monthlyCell.canonical_id, 'vat_report::2026-10');
  const bimonthlyCell = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'bi_monthly',
    facts: mixed,
    calendarDueDate: '2026-11-16',
  });
  assert.equal(bimonthlyCell.obligation_id, 'ob-bimonthly');
  assert.equal(bimonthlyCell.canonical_id, 'vat_report::2026-09-10');
});

test('repeated recompute preserves older incomplete VAT and does not duplicate identities', () => {
  const existing = [
    obligationIdentityKey('vat_report', '2026-07-08'),
    obligationIdentityKey('vat_report', '2026-08'),
    obligationIdentityKey('vat_report', '2026-09-10'),
  ];
  const currentRelevant = new Set([
    obligationIdentityKey('vat_report', '2026-09-10'),
    obligationIdentityKey('payroll_data', '2026-10'),
  ]);
  const first = historicalObligationIdentitiesToPreserve({
    existingKeys: existing,
    currentRelevantKeys: currentRelevant,
  });
  assert.deepEqual(first, [
    'vat_report::2026-07-08',
    'vat_report::2026-08',
  ]);
  const afterUpsert = [
    ...existing,
    obligationIdentityKey('payroll_data', '2026-10'),
  ];
  const second = historicalObligationIdentitiesToPreserve({
    existingKeys: afterUpsert,
    currentRelevantKeys: currentRelevant,
  });
  assert.deepEqual(second, first);
  const frequencyChange = historicalObligationIdentitiesToPreserve({
    existingKeys: ['vat_report::2026-10', 'vat_report::2026-09-10'],
    currentRelevantKeys: new Set(['vat_report::2026-09-10']),
  });
  assert.deepEqual(frequencyChange, ['vat_report::2026-10']);
});

test('monthly VAT is applicable every month; bimonthly VAT is not counted on odd months', () => {
  const monthlySep = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-09',
    vatFrequency: 'monthly',
    facts: [],
    calendarDueDate: '2026-10-19',
  });
  const bimonthlySep = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: false,
    operationalPeriodKey: '2026-09',
    vatFrequency: 'bi_monthly',
    facts: [],
    calendarDueDate: null,
  });
  const bimonthlyOct = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'bi_monthly',
    facts: [],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(monthlySep.applicable, true);
  assert.equal(monthlySep.canonical_id, 'vat_report::2026-09');
  assert.equal(bimonthlySep.applicable, false);
  assert.equal(bimonthlyOct.applicable, true);
  assert.equal(bimonthlyOct.canonical_id, 'vat_report::2026-09-10');
  const sepCards = buildReportingKpiCards([
    { client_id: 'monthly', reporting: buildReportingRowPresentation([monthlySep], TODAY) },
    { client_id: 'bimonthly', reporting: buildReportingRowPresentation([bimonthlySep], TODAY) },
  ]);
  assert.equal(sepCards.find((c) => c.id === 'vat')?.total_count, 1);
  const octCards = buildReportingKpiCards([
    {
      client_id: 'bimonthly',
      reporting: buildReportingRowPresentation([bimonthlyOct], TODAY),
    },
  ]);
  assert.equal(octCards.find((c) => c.id === 'vat')?.total_count, 1);
});

test('two monthly VAT clients stay 0/2 when canonical_ids match', () => {
  const rows = [1, 2].map((n) => ({
    client_id: `c-month-${n}`,
    reporting: buildReportingRowPresentation(
      [cell({ kind: 'vat', submitted: false, canonical_id: 'vat_report::2026-10' })],
      TODAY,
    ),
  }));
  const vat = buildReportingKpiCards(rows).find((c) => c.id === 'vat');
  assert.equal(vat?.submitted_count, 0);
  assert.equal(vat?.total_count, 2);
});

test('missing obligation row still counts as required and not submitted', () => {
  const built = buildReportingCellInputFromFacts({
    kind: 'vat',
    applicable: true,
    operationalPeriodKey: '2026-10',
    vatFrequency: 'monthly',
    facts: [],
    calendarDueDate: '2026-11-16',
  });
  assert.equal(built.obligation_id, null);
  assert.equal(built.submitted, false);
  const vat = buildReportingKpiCards([
    {
      client_id: 'c-missing',
      reporting: buildReportingRowPresentation([built], TODAY),
    },
  ]).find((c) => c.id === 'vat');
  assert.equal(vat?.submitted_count, 0);
  assert.equal(vat?.total_count, 1);
});

test('income-tax advances KPI counts applicable clients only', () => {
  const rows = [
    {
      client_id: 'c-ita',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'income_tax_advance', submitted: true })],
        TODAY,
      ),
    },
    {
      client_id: 'c-none',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'income_tax_advance', applicable: false })],
        TODAY,
      ),
    },
  ];
  const card = buildReportingKpiCards(rows).find((c) => c.id === 'income_tax');
  assert.equal(card?.submitted_count, 1);
  assert.equal(card?.total_count, 1);
});

test('income-tax deductions KPI is a separate client count', () => {
  const rows = [
    {
      client_id: 'c-itd',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'income_tax_deductions', submitted: false })],
        TODAY,
      ),
    },
    {
      client_id: 'c-itd-2',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'income_tax_deductions', submitted: true })],
        TODAY,
      ),
    },
  ];
  const card = buildReportingKpiCards(rows).find((c) => c.id === 'income_tax_deductions');
  assert.equal(card?.submitted_count, 1);
  assert.equal(card?.total_count, 2);
});

test('NI deductions monthly KPI counts each client once; 102/100/126 are not three clients', () => {
  assert.equal(
    nationalInsuranceDeductionsPeriodicSubmitted({ reported_102: true, reported_100: true }),
    true,
  );
  assert.equal(
    nationalInsuranceDeductionsPeriodicSubmitted({ reported_102: true, reported_100: false }),
    false,
  );
  const row = {
    client_id: 'c-ni',
    reporting: buildReportingRowPresentation(
      [
        cell({ kind: 'national_insurance_deductions', submitted: true }),
        cell({ kind: 'payroll', submitted: false }),
      ],
      TODAY,
    ),
  };
  const cards = buildReportingKpiCards([row]);
  assert.equal(cards.find((c) => c.id === 'national_insurance_deductions')?.total_count, 1);
  assert.equal(cards.find((c) => c.id === 'national_insurance_deductions')?.submitted_count, 1);
  assert.equal(cards.find((c) => c.id === 'payroll')?.total_count, 1);
});

test('payroll KPI uses workflow completion, not material receipt', () => {
  assert.equal(payrollWorkflowCountsAsSubmitted({ sent_to_employer: true }), true);
  assert.equal(payrollWorkflowCountsAsSubmitted({ no_salaries_this_month: true }), true);
  assert.equal(payrollWorkflowCountsAsSubmitted({ sent_to_employer: false }), false);
  const built = buildReportingCellInputFromFacts({
    kind: 'payroll',
    applicable: true,
    submittedOverride: false,
    operationalPeriodKey: '2026-10',
    facts: [],
    calendarDueDate: null,
  });
  assert.equal(built.submitted, false);
  const done = buildReportingCellInputFromFacts({
    kind: 'payroll',
    applicable: true,
    submittedOverride: true,
    operationalPeriodKey: '2026-10',
    facts: [],
    calendarDueDate: null,
  });
  assert.equal(done.submitted, true);
});

test('annual KPI uses tax year Y-1 for operational 10.26 and counts all required clients', () => {
  assert.equal(resolveAnnualReportTaxYearForOperationalPeriod('2026-10'), 2025);
  assert.equal(annualAppliesToOperationalPeriod({ due_date: '2026-05-31', operational_period_key: '2026-10' }), false);
  const submitted = resolveAnnualReportKpiFact({ hasSubmissionForTaxYear: true });
  const open = resolveAnnualReportKpiFact({ hasSubmissionForTaxYear: false });
  assert.equal(submitted.required, true);
  assert.equal(open.required, true);
  const cards = buildReportingKpiCards([
    {
      client_id: 'a',
      reporting_kpi: {
        annual_required: true,
        annual_submitted: true,
        capital_required: false,
        capital_submitted: false,
      },
    },
    {
      client_id: 'b',
      reporting_kpi: {
        annual_required: true,
        annual_submitted: false,
        capital_required: false,
        capital_submitted: false,
      },
    },
  ]);
  const annual = cards.find((c) => c.id === 'annual');
  assert.equal(annual?.submitted_count, 1);
  assert.equal(annual?.total_count, 2);
});

test('capital declaration KPI requires a filing date and uses submission status', () => {
  assert.deepEqual(
    resolveCapitalDeclarationKpiFact({ open: { operational_target_date: null, status: 'open' }, datedCompleted: [] }),
    { required: false, submitted: false },
  );
  assert.deepEqual(
    resolveCapitalDeclarationKpiFact({
      open: { operational_target_date: '2026-11-30', status: 'open' },
      datedCompleted: [],
    }),
    { required: true, submitted: false },
  );
  assert.deepEqual(
    resolveCapitalDeclarationKpiFact({
      open: null,
      datedCompleted: [{ operational_target_date: '2026-03-01', status: 'completed' }],
    }),
    { required: true, submitted: true },
  );
});

test('previous-period VAT calendar family follows regular vs PCN client settings', () => {
  const calendar = new Map([
    ['vat_regular_income_tax_advances::2026-09', '2026-10-19'],
    ['vat_detailed::2026-09', '2026-10-26'],
  ]);
  assert.equal(
    resolvePreviousPeriodVatCalendarDue({
      vat_frequency: 'monthly',
      vat_type: 'yes',
      vat_due_type: 'regular',
      operational_period_key: '2026-09',
      calendarDueByKey: calendar,
    }),
    '2026-10-19',
  );
  assert.equal(
    resolvePreviousPeriodVatCalendarDue({
      vat_frequency: 'monthly',
      vat_type: 'yes',
      vat_due_type: 'pcn',
      operational_period_key: '2026-09',
      calendarDueByKey: calendar,
    }),
    '2026-10-26',
  );
});

test('business KPI filter keeps ITD and NI deductions separate; withholding remains an alias', () => {
  const itdRow = {
    client_id: 'c-itd',
    reporting: buildReportingRowPresentation([cell({ kind: 'income_tax_deductions' })], TODAY),
  };
  const niRow = {
    client_id: 'c-ni',
    reporting: buildReportingRowPresentation([cell({ kind: 'national_insurance_deductions' })], TODAY),
  };
  assert.equal(rowMatchesReportingKpiFilter(itdRow, 'income_tax_deductions'), true);
  assert.equal(rowMatchesReportingKpiFilter(niRow, 'income_tax_deductions'), false);
  assert.equal(rowMatchesReportingKpiFilter(niRow, 'national_insurance_deductions'), true);
  assert.equal(rowMatchesReportingKpiFilter(itdRow, 'withholding'), true);
  assert.equal(rowMatchesReportingKpiFilter(niRow, 'withholding'), true);
});

test('form 126 completion does not submit the monthly NI deductions KPI', () => {
  assert.equal(
    nationalInsuranceDeductionsPeriodicSubmitted({ reported_102: false, reported_100: false }),
    false,
  );
  const cards = buildReportingKpiCards([
    {
      client_id: 'c-126',
      reporting: buildReportingRowPresentation(
        [cell({ kind: 'national_insurance_deductions', submitted: false })],
        TODAY,
      ),
    },
  ]);
  const ni = cards.find((c) => c.id === 'national_insurance_deductions');
  assert.equal(ni?.submitted_count, 0);
  assert.equal(ni?.total_count, 1);
});

test('business filters change reporting KPI denominators via the filtered population', () => {
  const all = [
    {
      client_id: 'company',
      reporting: buildReportingRowPresentation([cell({ kind: 'vat', submitted: true })], TODAY),
    },
    {
      client_id: 'osek',
      reporting: buildReportingRowPresentation([cell({ kind: 'vat', submitted: false })], TODAY),
    },
  ];
  const allVat = buildReportingKpiCards(all).find((c) => c.id === 'vat');
  assert.equal(`${allVat?.submitted_count}/${allVat?.total_count}`, '1/2');
  const companyOnly = buildReportingKpiCards(all.filter((r) => r.client_id === 'company')).find(
    (c) => c.id === 'vat',
  );
  assert.equal(`${companyOnly?.submitted_count}/${companyOnly?.total_count}`, '1/1');
});

test('payroll KPI helpers ignore material receipt; annual KPI click uses reporting_kpi facts', () => {
  assert.equal(payrollWorkflowCountsAsSubmitted({ sent_to_employer: false, no_salaries_this_month: false }), false);
  const annualRow = {
    client_id: 'c-annual',
    reporting_kpi: {
      annual_required: true,
      annual_submitted: false,
      capital_required: false,
      capital_submitted: false,
    },
  };
  assert.equal(rowMatchesReportingKpiFilter(annualRow, 'annual'), true);
  assert.equal(rowMatchesReportingKpiFilter(annualRow, 'capital_declaration'), false);
  assert.equal(
    rowMatchesReportingKpiFilter(
      {
        client_id: 'c-cap',
        reporting_kpi: {
          annual_required: true,
          annual_submitted: false,
          capital_required: true,
          capital_submitted: false,
        },
      },
      'capital_declaration',
    ),
    true,
  );
});

test('reporting dashboard wiring stays presentation-owned: payroll workflow, taxByClient, no material KPI', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const dashboardService = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-reporting-dashboard.service.ts'),
    'utf8',
  );
  const registryService = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  assert.match(dashboardService, /payrollWorkflowCountsAsSubmitted/);
  assert.match(dashboardService, /nationalInsuranceDeductionsPeriodicSubmitted/);
  assert.match(dashboardService, /taxByClient/);
  assert.match(dashboardService, /resolvePreviousPeriodVatCalendarDue/);
  assert.doesNotMatch(dashboardService, /material_brought/);
  assert.match(registryService, /loadPayrollPeriodWorkflowState/);
  assert.match(registryService, /loadAnnualReportSubmissionsForTaxYear/);
  assert.match(registryService, /loadCapitalDeclarationKpiInstances/);
  assert.match(registryService, /taxByClient:/);
});



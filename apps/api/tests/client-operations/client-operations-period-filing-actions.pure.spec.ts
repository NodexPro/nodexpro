/**
 * Period filing actions: VAT / income-tax advance / deductions / payroll.
 * Parameterized across clients, frequencies, past/current/future periods,
 * and filing/payment states. No client-name or month special cases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportingCellInputFromFacts,
  buildReportingCellPresentation,
  filingKindAllowsCreateOnReport,
  selectedPeriodCanReport,
  type ClientOperationsReportingFilingFact,
  type ClientOperationsReportingObligationKind,
} from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';
import {
  buildIncomeTaxDeductionsRegistryCell,
  incomeTaxAdvanceFilingPeriodIdentity,
  isIncomeTaxDeductionsFrequencyApplicableForOperationalPeriod,
  isIncomeTaxFrequencyApplicableForOperationalPeriod,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';
import { CO_UI } from '../../src/domains/client-operations/client-operations-ui-labels.pure.js';

const TODAY = '2026-11-15';
const PAST = '2026-08';
const CURRENT = '2026-11';
const FUTURE_EVEN = '2026-12';
const FUTURE_ODD = '2027-01';

type ClientFixture = {
  id: string;
  vat_frequency: 'monthly' | 'bi_monthly';
  ita_enabled: boolean;
  ita_frequency: 'monthly' | 'bi_monthly' | 'semi_annual' | null;
  itd_file: boolean;
  itd_frequency: 'monthly' | 'bi_monthly' | 'semi_annual' | null;
};

const CLIENTS: ClientFixture[] = [
  {
    id: 'monthly-all',
    vat_frequency: 'monthly',
    ita_enabled: true,
    ita_frequency: 'monthly',
    itd_file: true,
    itd_frequency: 'monthly',
  },
  {
    id: 'bimonthly-advances',
    vat_frequency: 'bi_monthly',
    ita_enabled: true,
    ita_frequency: 'bi_monthly',
    itd_file: true,
    itd_frequency: 'bi_monthly',
  },
  {
    id: 'semi-annual-advances',
    vat_frequency: 'monthly',
    ita_enabled: true,
    ita_frequency: 'semi_annual',
    itd_file: true,
    itd_frequency: 'semi_annual',
  },
  {
    id: 'advances-off',
    vat_frequency: 'monthly',
    ita_enabled: false,
    ita_frequency: null,
    itd_file: false,
    itd_frequency: null,
  },
];

const PERIODS = [PAST, CURRENT, FUTURE_EVEN, FUTURE_ODD] as const;

function fact(
  kind: 'vat_report' | 'income_tax_advance',
  period_key: string,
  status: string,
  obligation_id: string,
): ClientOperationsReportingFilingFact {
  return {
    obligation_id,
    obligation_type: kind,
    period_key,
    status,
    due_date: null,
    last_reported_at: status.startsWith('reported') ? `${period_key}-15T00:00:00.000Z` : null,
    is_active: true,
  };
}

function actionsFor(kind: ClientOperationsReportingObligationKind, period: string, facts: ClientOperationsReportingFilingFact[]) {
  const input = buildReportingCellInputFromFacts({
    kind,
    applicable: true,
    operationalPeriodKey: period,
    vatFrequency: kind === 'vat' ? 'monthly' : undefined,
    facts,
    calendarDueDate: null,
  });
  const detail = buildReportingCellPresentation(input, TODAY).filing_detail;
  return {
    obligation_id: input.obligation_id,
    submitted: input.submitted,
    can_report: detail?.can_report ?? false,
    can_report_and_pay: detail?.can_report_and_pay ?? false,
    can_mark_paid: detail?.can_mark_paid ?? false,
    chrome: detail?.chrome ?? null,
    report_disabled_reason_key: detail?.report_disabled_reason_key ?? null,
    paid_disabled_reason_key: detail?.paid_disabled_reason_key ?? null,
  };
}

test('create-on-report is only for filing-modal kinds, not deductions or payroll', () => {
  assert.equal(filingKindAllowsCreateOnReport('vat'), true);
  assert.equal(filingKindAllowsCreateOnReport('income_tax_advance'), true);
  assert.equal(filingKindAllowsCreateOnReport('income_tax_deductions'), false);
  assert.equal(filingKindAllowsCreateOnReport('payroll'), false);
  assert.equal(filingKindAllowsCreateOnReport('national_insurance'), false);
});

test('income-tax advance identity is YYYY-MM and does not reuse VAT pair keys', () => {
  assert.deepEqual(
    incomeTaxAdvanceFilingPeriodIdentity({
      enabled: true,
      frequency: 'monthly',
      operational_period_key: PAST,
    }),
    { period_key: PAST },
  );
  assert.deepEqual(
    incomeTaxAdvanceFilingPeriodIdentity({
      enabled: true,
      frequency: 'bi_monthly',
      operational_period_key: '2026-09',
    }),
    { period_key: '2026-09' },
  );
  assert.equal(
    incomeTaxAdvanceFilingPeriodIdentity({
      enabled: true,
      frequency: 'bi_monthly',
      operational_period_key: FUTURE_EVEN,
    }),
    null,
  );
  assert.equal(
    incomeTaxAdvanceFilingPeriodIdentity({
      enabled: true,
      frequency: 'semi_annual',
      operational_period_key: CURRENT,
    }),
    null,
  );
  assert.deepEqual(
    incomeTaxAdvanceFilingPeriodIdentity({
      enabled: true,
      frequency: 'semi_annual',
      operational_period_key: FUTURE_ODD,
    }),
    { period_key: FUTURE_ODD },
  );
  assert.equal(
    incomeTaxAdvanceFilingPeriodIdentity({
      enabled: false,
      frequency: 'monthly',
      operational_period_key: CURRENT,
    }),
    null,
  );
});

test('ITA bi_monthly uses odd months; ITD bi_monthly uses VAT even months', () => {
  assert.equal(isIncomeTaxFrequencyApplicableForOperationalPeriod('bi_monthly', '2026-09'), true);
  assert.equal(isIncomeTaxFrequencyApplicableForOperationalPeriod('bi_monthly', '2026-08'), false);
  assert.equal(isIncomeTaxDeductionsFrequencyApplicableForOperationalPeriod('bi_monthly', '2026-08'), true);
  assert.equal(isIncomeTaxDeductionsFrequencyApplicableForOperationalPeriod('bi_monthly', '2026-09'), false);
});

test('applicable missing obligation does not block VAT or ITA report on past/current/future periods', () => {
  for (const period of PERIODS) {
    for (const kind of ['vat', 'income_tax_advance'] as const) {
      const row = actionsFor(kind, period, []);
      assert.equal(row.obligation_id, null, `${kind} ${period} missing row`);
      assert.equal(row.submitted, false);
      assert.equal(row.can_report, true, `${kind} ${period} can_report`);
      assert.equal(row.can_report_and_pay, true, `${kind} ${period} can_report_and_pay`);
      assert.equal(row.can_mark_paid, false);
      assert.equal(row.paid_disabled_reason_key, CO_UI.reporting.filing.payRequiresFiling);
    }
  }
});

test('prior unfiled period does not block a later applicable period for VAT or ITA', () => {
  const laterFacts: ClientOperationsReportingFilingFact[] = [
    fact('vat_report', PAST, 'missing_data', 'vat-past'),
    fact('income_tax_advance', PAST, 'waiting_for_income_data', 'ita-past'),
  ];
  const vat = actionsFor('vat', CURRENT, laterFacts);
  const ita = actionsFor('income_tax_advance', CURRENT, laterFacts);
  assert.equal(vat.obligation_id, null);
  assert.equal(ita.obligation_id, null);
  assert.equal(vat.can_report, true);
  assert.equal(ita.can_report, true);
});

test('filed unpaid / filed paid / not applicable follow the three-button matrix for every client fixture', () => {
  for (const client of CLIENTS) {
    for (const period of PERIODS) {
      const itaApplies =
        client.ita_enabled &&
        isIncomeTaxFrequencyApplicableForOperationalPeriod(client.ita_frequency, period);
      if (!itaApplies) {
        assert.equal(
          incomeTaxAdvanceFilingPeriodIdentity({
            enabled: client.ita_enabled,
            frequency: client.ita_frequency,
            operational_period_key: period,
          }),
          null,
          `${client.id} ${period} not applicable`,
        );
        continue;
      }
      const unfiled = actionsFor('income_tax_advance', period, []);
      assert.equal(unfiled.can_report, true, `${client.id} ${period} unfiled report`);
      assert.equal(unfiled.can_mark_paid, false);

      const unpaid = actionsFor('income_tax_advance', period, [
        fact('income_tax_advance', period, 'reported', `${client.id}-unpaid`),
      ]);
      assert.equal(unpaid.can_report, false);
      assert.equal(unpaid.can_report_and_pay, false);
      assert.equal(unpaid.can_mark_paid, true);
      assert.equal(unpaid.chrome, 'filed_unpaid');
      assert.equal(unpaid.report_disabled_reason_key, CO_UI.reporting.filing.alreadyFiled);

      const paid = actionsFor('income_tax_advance', period, [
        fact('income_tax_advance', period, 'reported', `${client.id}-paid`),
      ]);
      const paidPresentation = buildReportingCellPresentation(
        {
          ...buildReportingCellInputFromFacts({
            kind: 'income_tax_advance',
            applicable: true,
            operationalPeriodKey: period,
            facts: [fact('income_tax_advance', period, 'reported', `${client.id}-paid`)],
            calendarDueDate: null,
            paymentClassification: 'paid_in_full',
          }),
        },
        TODAY,
      ).filing_detail;
      assert.equal(paidPresentation?.can_report, false);
      assert.equal(paidPresentation?.can_mark_paid, false);
      assert.equal(paidPresentation?.chrome, 'filed_paid');
      assert.equal(paid.can_report, false);
    }
  }
});

test('income-tax deductions stay on the period-table checkbox path, not the three-button modal', () => {
  const missing = buildReportingCellInputFromFacts({
    kind: 'income_tax_deductions',
    applicable: true,
    operationalPeriodKey: PAST,
    facts: [],
    calendarDueDate: null,
  });
  assert.equal(missing.obligation_id, null);
  assert.equal(buildReportingCellPresentation(missing, TODAY).filing_detail, null);

  const due = buildIncomeTaxDeductionsRegistryCell({
    configured: true,
    due: true,
    completed: false,
  });
  assert.equal(due.editable, true);
  assert.equal(due.applicable, true);

  const notDue = buildIncomeTaxDeductionsRegistryCell({
    configured: true,
    due: false,
    completed: false,
  });
  assert.equal(notDue.editable, false);
  assert.equal(notDue.applicable, false);
});

test('payroll reporting overlay is off so שכר stays כן/לא without a filing checkbox', () => {
  const payroll = buildReportingCellInputFromFacts({
    kind: 'payroll',
    applicable: true,
    operationalPeriodKey: CURRENT,
    facts: [
      {
        obligation_id: 'ob-pay',
        obligation_type: 'payroll_data',
        period_key: CURRENT,
        status: 'ready_to_process',
        due_date: null,
        last_reported_at: null,
        is_active: true,
      },
    ],
    calendarDueDate: null,
  });
  const cell = buildReportingCellPresentation(payroll, TODAY);
  assert.equal(cell.overlay_visible, false);
  assert.equal(cell.filing_detail, null);
  assert.equal(cell.can_mark_submitted, true);
});

test('selectedPeriodCanReport does not copy VAT missing-row policy onto deductions', () => {
  assert.equal(
    selectedPeriodCanReport({
      kind: 'income_tax_deductions',
      applicable: true,
      submitted: false,
      obligation_id: null,
    }),
    false,
  );
  assert.equal(
    selectedPeriodCanReport({
      kind: 'income_tax_advance',
      applicable: true,
      submitted: false,
      obligation_id: null,
    }),
    true,
  );
});

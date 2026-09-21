import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REPORTING_OBLIGATION_KEYS,
  buildReportingCalendarPeriodRow,
  formatFilingDueDateDisplay,
  incomeTaxAdvancesObligationKey,
  incomeTaxDeductionsObligationKey,
  isNationalInsuranceObligationKey,
  resolveVatObligationKeyFromClientTaxSettings,
  unresolvedReportingDueDate,
  assessYearPublicationCompleteness,
  isVatReportingPeriodApplicable,
} from '../../src/domains/country-pack/reporting-calendar.pure.js';

test('reporting period is distinct from filing month', () => {
  const row = buildReportingCalendarPeriodRow({
    reporting_period_key: '2026-12',
    cells: {
      vat_detailed: {
        obligation_key: 'vat_detailed',
        label: 'מע״מ מפורט',
        entry_id: 'entry-1',
        filing_due_date: '2027-01-26',
        filing_due_date_display: formatFilingDueDateDisplay('2027-01-26'),
        status: 'draft',
        explanation_code: null,
        replaces_entry_id: null,
        is_runtime_legal_truth: false,
      },
    },
  });

  assert.equal(row.reporting_period_key, '2026-12');
  assert.equal(row.year, 2026);
  assert.equal(row.month, 12);
  assert.equal(row.cells.vat_detailed.filing_due_date_display, '26/01/2027');
});

test('VAT regular and PCN map to separate Tax Authority obligation keys', () => {
  assert.equal(
    resolveVatObligationKeyFromClientTaxSettings({ vat_type: 'yes', vat_due_type: 'regular' }),
    'vat_regular_income_tax_advances'
  );
  assert.equal(resolveVatObligationKeyFromClientTaxSettings({ vat_type: 'yes', vat_due_type: 'pcn' }), 'vat_detailed');
  assert.equal(incomeTaxAdvancesObligationKey(), 'vat_regular_income_tax_advances');
  assert.equal(incomeTaxDeductionsObligationKey(), 'income_tax_deductions');
});

test('VAT patur and not_relevant do not produce a reporting calendar obligation', () => {
  assert.equal(resolveVatObligationKeyFromClientTaxSettings({ vat_type: 'patur', vat_due_type: 'regular' }), null);
  assert.equal(resolveVatObligationKeyFromClientTaxSettings({ vat_type: 'yes', vat_due_type: 'not_relevant' }), null);
  assert.equal(resolveVatObligationKeyFromClientTaxSettings({ vat_type: 'no', vat_due_type: 'pcn' }), null);
});

test('National Insurance is explicitly refused by the reporting calendar vocabulary', () => {
  assert.equal(isNationalInsuranceObligationKey('national_insurance_deductions'), true);
  assert.equal(isNationalInsuranceObligationKey('bituach_leumi_deductions'), true);
  assert.equal(
    unresolvedReportingDueDate('IL', 'national_insurance_deductions', '2026-01', 'national_insurance_not_in_tax_authority_calendar').reason,
    'national_insurance_not_in_tax_authority_calendar'
  );
});

test('stable obligation keys exclude National Insurance', () => {
  assert.deepEqual(REPORTING_OBLIGATION_KEYS, [
    'vat_regular_income_tax_advances',
    'income_tax_deductions',
    'vat_detailed',
  ]);
  assert.equal(REPORTING_OBLIGATION_KEYS.some((key) => key.toLowerCase().includes('insurance')), false);
});

test('pure module has no statutory-day constants', () => {
  const purePath = fileURLToPath(new URL('../../src/domains/country-pack/reporting-calendar.pure.ts', import.meta.url));
  const source = readFileSync(purePath, 'utf8');
  assert.equal(/\b(15|16|23)\b/.test(source), false);
});

test('year publication rejects incomplete sets before legal mutation', () => {
  const cells = REPORTING_OBLIGATION_KEYS.flatMap((obligation_key) =>
    Array.from({ length: 11 }, (_, i) => ({
      reporting_period_key: `2026-${String(i + 1).padStart(2, '0')}`,
      obligation_key,
      draft_id: `d-${obligation_key}-${i + 1}`,
      active_id: null as string | null,
      effective_filing_due_date: `2026-${String(((i + 1) % 12) + 1).padStart(2, '0')}-15`,
    }))
  );
  const assessment = assessYearPublicationCompleteness(2026, cells);
  assert.equal(assessment.complete, false);
  assert.equal(assessment.expected_count, 36);
  assert.ok(assessment.missing.some((m) => m.reporting_period_key === '2026-12'));
});

test('bi-monthly VAT skips non-applicable months in backend resolver vocabulary', () => {
  assert.equal(isVatReportingPeriodApplicable({ vat_frequency: 'bi_monthly', reporting_period_key: '2026-01' }), true);
  assert.equal(isVatReportingPeriodApplicable({ vat_frequency: 'bi_monthly', reporting_period_key: '2026-02' }), false);
  assert.equal(isVatReportingPeriodApplicable({ vat_frequency: 'monthly', reporting_period_key: '2026-02' }), true);
});


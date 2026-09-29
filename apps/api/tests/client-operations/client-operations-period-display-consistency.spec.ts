/**
 * Client Operations — configuration display vs period filing applicability.
 *
 * `—` = no obligation/configuration for the period.
 * `—` must NOT mean "not a filing month".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeOperationalPeriodApplicability,
  resolvePayrollApplicabilityFromDeductionsFiles,
  resolvePayrollApplicabilityFromFrozenSnapshot,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';
import { formatIncomeTaxAdvanceRegistryFrequencyDisplayHe } from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';
import { computeVatRegistryColumnDisplayHe } from '../../src/domains/client-operations/vat-divuach.js';
import { buildNiDeductionsRegistryCell } from '../../src/domains/client-operations/client-operations-ni-deductions-126.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const viewSource = readFileSync(
  join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const periodPureSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-operational-period.pure.ts'),
  'utf8',
);

const PERIODS = ['2026-08', '2026-09', '2026-10', '2026-11'] as const;

test('A — VAT bi_monthly frequency DISPLAY every month 08–11', () => {
  for (const period of PERIODS) {
    void period;
    assert.equal(
      computeVatRegistryColumnDisplayHe('עוסק מורשה', 'yes', 'bi_monthly'),
      'דו-חודשי',
    );
  }
});

test('B — income-tax advances bi_monthly DISPLAY every month 08–11', () => {
  for (const period of PERIODS) {
    void period;
    assert.equal(
      formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({
        enabled: true,
        frequency: 'bi_monthly',
      }),
      'דו-חודשי',
    );
  }
});

test('C — IT deductions file → שכר + חומר שכר every month; ITD schedule independent', () => {
  const inputs = {
    vat_type: 'yes' as string | null,
    vat_frequency: 'bi_monthly' as string | null,
    payroll_flag: null as boolean | null,
    income_tax_advance_enabled: true as boolean | null,
    income_tax_advance_frequency: 'bi_monthly' as string | null,
    income_tax_deductions_enabled: true as boolean | null,
    income_tax_deductions_file_number: 'IT-1' as string | null,
    income_tax_deductions_frequency: 'bi_monthly' as string | null,
    national_insurance_type: null as string | null,
    national_insurance_monthly_amount: null as number | null,
    national_insurance_deductions_file_number: null as string | null,
  };
  for (const period of PERIODS) {
    const appl = computeOperationalPeriodApplicability(period, inputs);
    assert.equal(appl.payroll_applicable, true, `שכר ${period}`);
    const itdDue = period === '2026-08' || period === '2026-10';
    assert.equal(appl.income_tax_deductions_applicable, itdDue, `מ״ה ניכויים ${period}`);
  }
});

test('D — NI file only → שכר every month 08–11', () => {
  for (const period of PERIODS) {
    assert.equal(
      computeOperationalPeriodApplicability(period, {
        vat_type: null,
        vat_frequency: null,
        payroll_flag: null,
        income_tax_advance_enabled: null,
        income_tax_advance_frequency: null,
        income_tax_deductions_enabled: null,
        income_tax_deductions_file_number: null,
        income_tax_deductions_frequency: null,
        national_insurance_type: null,
        national_insurance_monthly_amount: null,
        national_insurance_deductions_file_number: 'NI-1',
      }).payroll_applicable,
      true,
    );
  }
});

test('E — NI deductions: 102/100 monthly when file applicable; 126 cycle-based', () => {
  const cell = buildNiDeductionsRegistryCell({
    applicable: true,
    reported102: false,
    reported100: true,
    outstanding126: [{ reporting_year: 2025, cycle_type: 'h1' }],
  });
  assert.equal(cell.items['102']?.applicable, true);
  assert.equal(cell.items['100']?.applicable, true);
  assert.equal(cell.items['126']?.applicable, true);
  assert.equal(cell.items['126']?.outstanding_count, 1);
  const na = buildNiDeductionsRegistryCell({
    applicable: false,
    reported102: true,
    reported100: true,
    outstanding126: [],
  });
  assert.equal(na.items['102']?.applicable, false);
  assert.equal(na.items['100']?.applicable, false);
});

test('F — no deductions files → שכר false', () => {
  assert.equal(
    resolvePayrollApplicabilityFromDeductionsFiles({
      income_tax_deductions_file_number: null,
      national_insurance_deductions_file_number: null,
    }),
    false,
  );
});

test('G — historical payroll from frozen evidence; not live files', () => {
  assert.equal(
    resolvePayrollApplicabilityFromFrozenSnapshot({
      payroll_applicable: false,
      income_tax_deductions_enabled: true,
      national_insurance_deductions_file_number: null,
    }),
    true,
  );
  assert.equal(
    resolvePayrollApplicabilityFromFrozenSnapshot({
      payroll_applicable: false,
      income_tax_deductions_enabled: null,
      national_insurance_deductions_file_number: 'NI',
    }),
    true,
  );
  // H — no frozen evidence → stay false (live files must not invent history)
  assert.equal(
    resolvePayrollApplicabilityFromFrozenSnapshot({
      payroll_applicable: false,
      income_tax_deductions_enabled: false,
      national_insurance_deductions_file_number: null,
    }),
    false,
  );
  assert.match(serviceSource, /resolvePayrollApplicabilityFromFrozenSnapshot/);
  assert.doesNotMatch(
    serviceSource,
    /isCurrentOpenPeriod\s*\?[\s\S]{0,200}Boolean\(snapshot\?\.payroll_applicable\)/,
  );
});

test('I — historical VAT display uses snapshot vat_type/frequency', () => {
  assert.match(serviceSource, /vatTypeForDisplay/);
  assert.match(serviceSource, /vatFrequencyForDisplay/);
  assert.match(serviceSource, /snapshot\.vat_type/);
  assert.match(serviceSource, /snapshot\.vat_frequency/);
  assert.match(
    serviceSource,
    /computeVatRegistryColumnDisplayHe\(\s*bt,\s*vatTypeForDisplay,\s*vatFrequencyForDisplay/,
  );
});

test('FE must not overwrite configured cells with — from obligationApplicable', () => {
  assert.doesNotMatch(
    viewSource,
    /if \(applicable === false\)[\s\S]{0,200}nx-co-sheet__na[\s\S]{0,80}—/,
  );
  assert.match(viewSource, /Period "not due this month" must NOT overwrite/);
});

test('snapshot creation still freezes payroll from deductions files', () => {
  assert.match(periodPureSource, /resolvePayrollApplicabilityFromDeductionsFiles/);
  assert.match(
    periodPureSource,
    /const payroll_applicable = resolvePayrollApplicabilityFromDeductionsFiles/,
  );
});

/**
 * Quick Profile presentation rows — VAT frequency / advances / payroll / deductions.
 * Backend-owned labels only; no React branching.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatQuickProfileIncomeTaxAdvancesDisplayHe,
  formatQuickProfileIncomeTaxDeductionsDisplayHe,
  formatQuickProfilePayrollDisplayHe,
  formatIncomeTaxDeductionsFrequencyLabelHe,
  buildQuickProfileIncomeTaxDeductionsProjection,
  buildQuickProfileNationalInsuranceDeductionsProjection,
  QUICK_PROFILE_EMPTY_DISPLAY,
} from '../../src/domains/client-operations/client-operations-client-quick-profile.pure.js';
import { computeVatRegistryColumnDisplayHe } from '../../src/domains/client-operations/vat-divuach.js';

const dir = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-client-quick-profile.service.ts'),
  'utf8'
);
const popover = readFileSync(
  join(
    dir,
    '../../../web/src/components/client-operations/ClientOperationsClientQuickProfilePopover.tsx'
  ),
  'utf8'
);
const resolver = readFileSync(
  join(dir, '../../src/domains/country-pack/reporting-calendar-resolver.service.ts'),
  'utf8'
);

test('VAT חודשי / דו-חודשי / פטור presentation from canonical registry helper', () => {
  assert.equal(computeVatRegistryColumnDisplayHe(null, 'yes', 'monthly'), 'חודשי');
  assert.equal(computeVatRegistryColumnDisplayHe(null, 'yes', 'bi_monthly'), 'דו-חודשי');
  assert.equal(computeVatRegistryColumnDisplayHe('עוסק פטור', 'patur', 'not_relevant'), 'פטור');
});

test('PCN remains backend vat_due_type selection — not frequency', () => {
  assert.match(service, /vat_due_type:\s*settings\.vat_due_type/);
  assert.match(resolver, /resolveVatObligationKeyFromClientTaxSettings/);
});

test('advances disabled / enabled + percent', () => {
  assert.equal(
    formatQuickProfileIncomeTaxAdvancesDisplayHe({ enabled: false, percent: 5 }),
    'לא'
  );
  assert.equal(
    formatQuickProfileIncomeTaxAdvancesDisplayHe({ enabled: true, percent: 5 }),
    'כן · 5%'
  );
  assert.equal(
    formatQuickProfileIncomeTaxAdvancesDisplayHe({ enabled: true, percent: null }),
    'כן'
  );
});

test('payroll true → שכר כן; false → לא; null → empty', () => {
  assert.equal(formatQuickProfilePayrollDisplayHe(true), 'כן');
  assert.equal(formatQuickProfilePayrollDisplayHe(false), 'לא');
  assert.equal(formatQuickProfilePayrollDisplayHe(null), QUICK_PROFILE_EMPTY_DISPLAY);
});

test('deductions applicability presentation (legacy כן/לא)', () => {
  assert.equal(formatQuickProfileIncomeTaxDeductionsDisplayHe(true), 'כן');
  assert.equal(formatQuickProfileIncomeTaxDeductionsDisplayHe(false), 'לא');
});

test('income-tax deductions file + frequency projection (copyable; no file → —)', () => {
  assert.equal(formatIncomeTaxDeductionsFrequencyLabelHe('monthly'), 'חודשי');
  assert.equal(formatIncomeTaxDeductionsFrequencyLabelHe('bi_monthly'), 'דו-חודשי');
  assert.equal(formatIncomeTaxDeductionsFrequencyLabelHe('semi_annual'), 'חצי שנתי');

  const withFile = buildQuickProfileIncomeTaxDeductionsProjection({
    file_number: '935123456',
    frequency: 'bi_monthly',
  });
  assert.equal(withFile.file_number, '935123456');
  assert.equal(withFile.frequency_label_he, 'דו-חודשי');
  assert.match(withFile.display_value, /935123456/);
  assert.match(withFile.display_value, /דו-חודשי/);
  assert.equal(withFile.copy_enabled, true);
  assert.equal(withFile.copy_value, '935123456');

  const noFile = buildQuickProfileIncomeTaxDeductionsProjection({
    file_number: null,
    frequency: 'monthly',
  });
  assert.equal(noFile.display_value, QUICK_PROFILE_EMPTY_DISPLAY);
  assert.equal(noFile.frequency_label_he, null);
  assert.equal(noFile.copy_enabled, false);
});

test('NI deductions file projection (copyable; no frequency invented)', () => {
  const withFile = buildQuickProfileNationalInsuranceDeductionsProjection({
    file_number: '123456789',
  });
  assert.equal(withFile.copy_enabled, true);
  assert.equal(withFile.copy_value, '123456789');
  assert.match(withFile.display_value, /123456789/);

  const noFile = buildQuickProfileNationalInsuranceDeductionsProjection({ file_number: '  ' });
  assert.equal(noFile.display_value, QUICK_PROFILE_EMPTY_DISPLAY);
  assert.equal(noFile.copy_enabled, false);
});

test('NI day 15 is NOT frontend-hardcoded; service only shows when resolver resolves', () => {
  assert.doesNotMatch(popover, /עד 15|15 לחודש/);
  assert.match(service, /ni && ni.resolved/);
  assert.doesNotMatch(service, /filing_due_date:\s*['"]15/);
});

test('one aggregate / one frontend GET; no frontend period or legal-date calculation', () => {
  assert.match(service, /CLIENT_OPERATIONS_CLIENT_QUICK_PROFILE_AGGREGATE_KEY/);
  assert.doesNotMatch(popover, /resolveVatOperational|bi_monthly\s*===|vat_frequency\s*===/);
  assert.doesNotMatch(popover, /getMonth\(/);
  assert.match(resolver, /biMonthlyVatPairEndPeriodKey/);
  assert.match(resolver, /isFilingDueDateAfterReportingPeriodEnd/);
});

test('service emits VAT/advances/payroll/deductions file rows from backend', () => {
  assert.match(service, /key: 'vat_frequency'/);
  assert.match(service, /key: 'income_tax_advances'/);
  assert.match(service, /key: 'payroll'/);
  assert.match(service, /key: 'income_tax_deductions'/);
  assert.match(service, /key: 'national_insurance_deductions'/);
  assert.match(service, /buildQuickProfileIncomeTaxDeductionsProjection/);
  assert.match(service, /income_tax_deductions_file_number/);
  assert.doesNotMatch(service, /formatQuickProfileIncomeTaxDeductionsDisplayHe\(/);
});

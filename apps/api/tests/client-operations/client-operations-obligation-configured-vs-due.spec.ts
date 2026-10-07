/**
 * Client Operations — configured ≠ due for system obligation squares.
 * Regression coverage for FIX 1 (material/NI cells) + FIX 2 (empty snapshot vs live tax).
 * Frontend must render backend cell model only — no frequency math.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIncomeTaxDeductionsRegistryCell,
  resolveIncomeTaxAdvanceConfigured,
  resolveIncomeTaxAdvanceMaterialForPeriod,
  resolveIncomeTaxDeductionsApplicability,
  resolveIncomeTaxDeductionsConfigured,
  resolveMaterialBroughtForPeriod,
  resolveNationalInsuranceDeductionsApplicability,
  resolvePayrollMaterialForPeriod,
  resolvePayrollObligationConfigured,
  resolveVatApplicabilityForOperationalPeriod,
  resolveVatObligationConfigured,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';
import { buildNiDeductionsRegistryCell } from '../../src/domains/client-operations/client-operations-ni-deductions-126.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const taxSettingsSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-tax-settings.service.ts'),
  'utf8',
);
const routesSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.routes.ts'),
  'utf8',
);
const registryView = readFileSync(
  join(dir, '../../../../apps/web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);

/** A — new client monthly VAT → VAT square enabled (configured+due). */
test('A — monthly VAT configured → enabled square in filing month', () => {
  const configured = resolveVatObligationConfigured({
    vat_type: 'yes',
    vat_frequency: 'monthly',
  });
  const due = resolveVatApplicabilityForOperationalPeriod({
    vat_type: 'yes',
    vat_frequency: 'monthly',
    operational_period_key: '2026-09',
  });
  assert.equal(configured, true);
  assert.equal(due, true);
  const cell = resolveMaterialBroughtForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-09',
    default_period_key: '2026-09',
    vat_configured: configured,
    vat_due: due,
  });
  assert.equal(cell.configured, true);
  assert.equal(cell.due, true);
  assert.equal(cell.applicable, true);
  assert.equal(cell.editable, true);
});

/** B — bi-monthly VAT in non-due month → configured + disabled, NOT dash. */
test('B — bi-monthly VAT in 2026-09 → configured + disabled square NOT dash', () => {
  const configured = resolveVatObligationConfigured({
    vat_type: 'yes',
    vat_frequency: 'bi_monthly',
  });
  const due = resolveVatApplicabilityForOperationalPeriod({
    vat_type: 'yes',
    vat_frequency: 'bi_monthly',
    operational_period_key: '2026-09',
  });
  assert.equal(configured, true);
  assert.equal(due, false);
  const cell = resolveMaterialBroughtForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-09',
    default_period_key: '2026-09',
    vat_configured: configured,
    vat_due: due,
  });
  assert.equal(cell.configured, true);
  assert.equal(cell.due, false);
  assert.equal(cell.applicable, false);
  assert.equal(cell.editable, false);
  assert.equal(cell.completed, null);
  assert.equal(cell.value, null);
});

/** C — bi-monthly VAT in due month → enabled. */
test('C — bi-monthly VAT in 2026-10 → enabled square', () => {
  const configured = resolveVatObligationConfigured({
    vat_type: 'yes',
    vat_frequency: 'bi_monthly',
  });
  const due = resolveVatApplicabilityForOperationalPeriod({
    vat_type: 'yes',
    vat_frequency: 'bi_monthly',
    operational_period_key: '2026-10',
  });
  assert.equal(configured, true);
  assert.equal(due, true);
  const cell = resolveMaterialBroughtForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-10',
    default_period_key: '2026-09',
    vat_configured: configured,
    vat_due: due,
  });
  assert.equal(cell.configured, true);
  assert.equal(cell.due, true);
  assert.equal(cell.applicable, true);
  assert.equal(cell.editable, true);
});

/** D — VAT not configured → dash. */
test('D — VAT not configured → dash shape', () => {
  const configured = resolveVatObligationConfigured({
    vat_type: null,
    vat_frequency: null,
  });
  assert.equal(configured, false);
  const cell = resolveMaterialBroughtForPeriod({
    period_fact: false,
    has_period_fact: false,
    legacy_profile_flag: false,
    operational_period_key: '2026-09',
    default_period_key: '2026-09',
    vat_configured: false,
    vat_due: false,
  });
  assert.equal(cell.configured, false);
  assert.equal(cell.due, false);
  assert.equal(cell.applicable, false);
  assert.equal(cell.value, null);
});

/** E — empty pre-setup snapshot must not shadow live tax on current/open (source contract). */
test('E — current/open period prefers live tax; tax save reconciles + cache invalidates', () => {
  assert.match(serviceSrc, /Current\/open period: live tax is canonical/);
  assert.match(serviceSrc, /isCurrentOpenPeriod/);
  assert.match(serviceSrc, /tax\?\.vat_type \?\? null/);
  assert.match(serviceSrc, /resolveVatObligationConfigured/);
  assert.match(taxSettingsSrc, /reconcileCurrentOpenPeriodApplicabilitySnapshotForClient/);
  assert.match(routesSrc, /invalidateClientOperationsRegistryMaterializationCache/);
  // No duplicate reconcile machinery outside tax-settings + existing service.
  assert.match(taxSettingsSrc, /Historical period snapshots remain frozen/);
});

/** F — existing configured monthly client does not regress. */
test('F — existing monthly VAT + advances + payroll configured behaviour', () => {
  assert.equal(
    resolveVatObligationConfigured({ vat_type: 'yes', vat_frequency: 'monthly' }),
    true,
  );
  assert.equal(resolveIncomeTaxAdvanceConfigured(true), true);
  assert.equal(
    resolvePayrollObligationConfigured({
      income_tax_deductions_file_number: '111',
      national_insurance_deductions_file_number: null,
    }),
    true,
  );
  const payroll = resolvePayrollMaterialForPeriod({
    payroll_configured: true,
    payroll_due: true,
    salary_data_received: false,
  });
  assert.equal(payroll.configured, true);
  assert.equal(payroll.due, true);
  assert.equal(payroll.applicable, true);

  const advanceDue = resolveIncomeTaxAdvanceMaterialForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-09',
    default_period_key: '2026-09',
    advance_configured: true,
    advance_due: true,
  });
  assert.equal(advanceDue.applicable, true);

  const advanceNotDue = resolveIncomeTaxAdvanceMaterialForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-09',
    default_period_key: '2026-09',
    advance_configured: true,
    advance_due: false,
  });
  assert.equal(advanceNotDue.configured, true);
  assert.equal(advanceNotDue.due, false);
  assert.equal(advanceNotDue.applicable, false);
});

/** G — Income Tax Deductions configured/due does not regress. */
test('G — ITD configured+not-due stays disabled square; not configured stays dash', () => {
  assert.equal(
    resolveIncomeTaxDeductionsConfigured({
      file_number: '935',
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'bi_monthly',
    }),
    true,
  );
  assert.equal(
    resolveIncomeTaxDeductionsApplicability({
      file_number: '935',
      frequency: 'bi_monthly',
      operational_period_key: '2026-09',
    }),
    false,
  );
  const disabled = buildIncomeTaxDeductionsRegistryCell({
    configured: true,
    due: false,
    completed: false,
  });
  assert.equal(disabled.configured, true);
  assert.equal(disabled.due, false);
  assert.equal(disabled.applicable, false);
  assert.equal(disabled.editable, false);

  const dash = buildIncomeTaxDeductionsRegistryCell({
    configured: false,
    due: false,
    completed: false,
  });
  assert.equal(dash.configured, false);
  assert.equal(dash.applicable, false);
});

test('NI deductions — file configured → squares; not configured → dash', () => {
  assert.equal(resolveNationalInsuranceDeductionsApplicability('NI-FILE'), true);
  assert.equal(resolveNationalInsuranceDeductionsApplicability(null), false);
  const configured = buildNiDeductionsRegistryCell({
    configured: true,
    due: true,
    reported102: false,
    reported100: false,
    outstanding126: [],
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.items['102'].configured, true);
  assert.equal(configured.items['102'].applicable, true);

  const none = buildNiDeductionsRegistryCell({
    configured: false,
    due: false,
    reported102: false,
    reported100: false,
    outstanding126: [],
  });
  assert.equal(none.configured, false);
  assert.equal(none.applicable, false);
});

test('FE — material/NI render configured then due; no frequency math', () => {
  assert.match(registryView, /stream\.cell\?\.configured \?\? stream\.cell\?\.applicable/);
  assert.match(registryView, /niCell\?\.configured \?\? niCell\?\.applicable/);
  assert.match(registryView, /מוגדר — אין דיווח בחודש זה/);
  assert.doesNotMatch(registryView, /bi_monthly|semi_annual|vat_frequency\s*===|month\s*%\s*2/);
  assert.doesNotMatch(registryView, /isVatBiMonthly|resolveVatApplicability/);
});

test('service wires configured+due into material/NI cells (source)', () => {
  assert.match(serviceSrc, /vat_configured:\s*vatConfigured/);
  assert.match(serviceSrc, /vat_due:\s*vatDue/);
  assert.match(serviceSrc, /advance_configured:\s*advanceConfigured/);
  assert.match(serviceSrc, /advance_due:\s*advanceDue/);
  assert.match(serviceSrc, /payroll_configured:\s*payrollConfigured/);
  assert.match(serviceSrc, /buildNiDeductionsRegistryCellForClient\(\{[\s\S]*?configured:\s*niDeductionsConfigured/);
});

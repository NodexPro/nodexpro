/**
 * Current/open CO period reconciliation after מיסים tax-settings save.
 * Historical snapshots remain frozen; only default_period_key may rebuild.
 * Persistence is atomic via CO-175 RPC (see atomic-snapshot-replace.spec).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeOperationalPeriodApplicability,
  isCurrentOpenOperationalPeriodKey,
  resolveDefaultOperationalPeriodKey,
  type OperationalPeriodSnapshotInputs,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

const baseInputs = (
  overrides: Partial<OperationalPeriodSnapshotInputs> = {},
): OperationalPeriodSnapshotInputs => ({
  vat_type: 'no',
  vat_frequency: 'not_relevant',
  payroll_flag: false,
  income_tax_advance_enabled: false,
  income_tax_advance_frequency: null,
  income_tax_deductions_enabled: true,
  income_tax_deductions_file_number: null,
  income_tax_deductions_frequency: null,
  national_insurance_type: null,
  national_insurance_monthly_amount: null,
  national_insurance_deductions_file_number: null,
  ...overrides,
});

test('current/open period = backend default_period_key only', () => {
  const now = new Date('2026-10-15T12:00:00+03:00');
  const open = resolveDefaultOperationalPeriodKey(now);
  assert.equal(open, '2026-09');
  assert.equal(isCurrentOpenOperationalPeriodKey('2026-09', now), true);
  assert.equal(isCurrentOpenOperationalPeriodKey('2026-08', now), false);
  assert.equal(isCurrentOpenOperationalPeriodKey('2026-10', now), false);
});

test('A — add file# + monthly → current September applicable', () => {
  const before = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({ income_tax_deductions_file_number: null, income_tax_deductions_frequency: 'monthly' }),
  );
  assert.equal(before.income_tax_deductions_applicable, false);

  const after = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({
      income_tax_deductions_file_number: '935123456',
      income_tax_deductions_frequency: 'monthly',
    }),
  );
  assert.equal(after.income_tax_deductions_applicable, true);
});

test('C — September monthly → applicable; change to bi_monthly → N/A', () => {
  assert.equal(
    computeOperationalPeriodApplicability(
      '2026-09',
      baseInputs({
        income_tax_deductions_file_number: '935123456',
        income_tax_deductions_frequency: 'monthly',
      }),
    ).income_tax_deductions_applicable,
    true,
  );
  assert.equal(
    computeOperationalPeriodApplicability(
      '2026-09',
      baseInputs({
        income_tax_deductions_file_number: '935123456',
        income_tax_deductions_frequency: 'bi_monthly',
      }),
    ).income_tax_deductions_applicable,
    false,
  );
});

test('D — October bi_monthly → applicable (VAT cadence)', () => {
  assert.equal(
    computeOperationalPeriodApplicability(
      '2026-10',
      baseInputs({
        income_tax_deductions_file_number: '935123456',
        income_tax_deductions_frequency: 'bi_monthly',
      }),
    ).income_tax_deductions_applicable,
    true,
  );
});

test('E/F/G — semi_annual Jan+Jun only; December N/A', () => {
  const file = {
    income_tax_deductions_file_number: '935123456',
    income_tax_deductions_frequency: 'semi_annual' as const,
  };
  assert.equal(
    computeOperationalPeriodApplicability('2027-01', baseInputs(file)).income_tax_deductions_applicable,
    true,
  );
  assert.equal(
    computeOperationalPeriodApplicability('2026-06', baseInputs(file)).income_tax_deductions_applicable,
    true,
  );
  assert.equal(
    computeOperationalPeriodApplicability('2026-12', baseInputs(file)).income_tax_deductions_applicable,
    false,
  );
});

test('H — remove file number → current becomes N/A', () => {
  assert.equal(
    computeOperationalPeriodApplicability(
      '2026-09',
      baseInputs({
        income_tax_deductions_file_number: null,
        income_tax_deductions_frequency: 'monthly',
      }),
    ).income_tax_deductions_applicable,
    false,
  );
});

test('I — Quick Profile reads live tax settings (not period snapshot)', () => {
  const qpService = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-client-quick-profile.service.ts'),
    'utf8',
  );
  assert.match(qpService, /from\('client_tax_settings'\)/);
  assert.match(qpService, /income_tax_deductions_file_number/);
  assert.match(qpService, /buildQuickProfileIncomeTaxDeductionsProjection/);
  assert.doesNotMatch(qpService, /period_applicability_snapshots/);
});

test('J — tax-settings save reconciles via atomic RPC only (source contract)', () => {
  const taxSettings = readFileSync(
    join(dir, '../../src/domains/client-operations/client-tax-settings.service.ts'),
    'utf8',
  );
  const periodSvc = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-operational-period.service.ts'),
    'utf8',
  );
  assert.match(taxSettings, /reconcileCurrentOpenPeriodApplicabilitySnapshotForClient/);
  assert.match(periodSvc, /replace_client_operations_period_applicability_snapshot/);
  assert.match(periodSvc, /resolveDefaultOperationalPeriodKey/);
  assert.match(periodSvc, /p_expected_tax_settings_updated_at/);
});

test('B — historical period key is not current/open', () => {
  const now = new Date('2026-10-15T12:00:00+03:00');
  assert.equal(isCurrentOpenOperationalPeriodKey('2026-08', now), false);
});

test('tax command path uses update_tax_income_deductions → updateClientTaxSettings', () => {
  const taxCommands = readFileSync(
    join(dir, '../../src/domains/client-operations/client-tax-commands.service.ts'),
    'utf8',
  );
  assert.match(taxCommands, /update_tax_income_deductions/);
  assert.match(taxCommands, /income_tax_deductions_file_number/);
  assert.match(taxCommands, /updateClientTaxSettings/);
  assert.doesNotMatch(taxCommands, /getMonth\(|bi_monthly\s*===/);
});

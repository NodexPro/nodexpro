/**
 * Client Operations Phase 1 — operational period foundation (pure unit tests).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAvailableOperationalPeriods,
  clientExistsInOperationalPeriod,
  computeOperationalPeriodApplicability,
  isVatBiMonthlyApplicableForOperationalPeriod,
  isVatMonthlyApplicableForOperationalPeriod,
  isVatPaturApplicableForOperationalPeriod,
  resolveMaterialBroughtForPeriod,
  resolveVatApplicabilityForOperationalPeriod,
  shouldIncludeArchivedClientInOperationalPeriodRegistry,
  type OperationalPeriodSnapshotInputs,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

const baseInputs = (
  overrides: Partial<OperationalPeriodSnapshotInputs> = {},
): OperationalPeriodSnapshotInputs => ({
  vat_type: 'yes',
  vat_frequency: 'monthly',
  payroll_flag: false,
  income_tax_advance_enabled: false,
  income_tax_advance_frequency: null,
  income_tax_deductions_enabled: false,
  income_tax_deductions_frequency: null,
  national_insurance_type: null,
  national_insurance_monthly_amount: null,
  national_insurance_deductions_file_number: null,
  ...overrides,
});

test('1 — VAT monthly: September applicable', () => {
  assert.equal(isVatMonthlyApplicableForOperationalPeriod('2026-09'), true);
  assert.equal(
    resolveVatApplicabilityForOperationalPeriod({
      vat_type: 'yes',
      vat_frequency: 'monthly',
      operational_period_key: '2026-09',
    }),
    true,
  );
});

test('2 — VAT bi-monthly: September N/A, October applicable', () => {
  assert.equal(isVatBiMonthlyApplicableForOperationalPeriod('2026-09'), false);
  assert.equal(isVatBiMonthlyApplicableForOperationalPeriod('2026-10'), true);
  assert.equal(
    resolveVatApplicabilityForOperationalPeriod({
      vat_type: 'yes',
      vat_frequency: 'bi_monthly',
      operational_period_key: '2026-09',
    }),
    false,
  );
  assert.equal(
    resolveVatApplicabilityForOperationalPeriod({
      vat_type: 'yes',
      vat_frequency: 'bi_monthly',
      operational_period_key: '2026-10',
    }),
    true,
  );
});

test('3 — VAT patur: November N/A, December applicable', () => {
  assert.equal(isVatPaturApplicableForOperationalPeriod('2026-11'), false);
  assert.equal(isVatPaturApplicableForOperationalPeriod('2026-12'), true);
  assert.equal(
    resolveVatApplicabilityForOperationalPeriod({
      vat_type: 'patur',
      vat_frequency: 'not_relevant',
      operational_period_key: '2026-11',
    }),
    false,
  );
  assert.equal(
    resolveVatApplicabilityForOperationalPeriod({
      vat_type: 'patur',
      vat_frequency: 'not_relevant',
      operational_period_key: '2026-12',
    }),
    true,
  );
});

test('4 — VAT bi-monthly + monthly advances: September visible; VAT N/A; advances applicable', () => {
  const r = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({
      vat_frequency: 'bi_monthly',
      income_tax_advance_enabled: true,
      income_tax_advance_frequency: 'monthly',
    }),
  );
  assert.equal(r.vat_applicable, false);
  assert.equal(r.income_tax_advance_applicable, true);
  assert.equal(r.row_visible, true);
});

test('5 — VAT patur + payroll: November visible via payroll; VAT N/A', () => {
  const r = computeOperationalPeriodApplicability(
    '2026-11',
    baseInputs({
      vat_type: 'patur',
      vat_frequency: 'not_relevant',
      payroll_flag: true,
    }),
  );
  assert.equal(r.vat_applicable, false);
  assert.equal(r.payroll_applicable, true);
  assert.equal(r.row_visible, true);
});

test('6 — period material facts coexist (Aug true / Sep false)', () => {
  const august = resolveMaterialBroughtForPeriod({
    period_fact: true,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-08',
    default_period_key: '2026-09',
    vat_applicable: true,
  });
  const september = resolveMaterialBroughtForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: true,
    operational_period_key: '2026-09',
    default_period_key: '2026-09',
    vat_applicable: true,
  });
  assert.deepEqual(august, { applicable: true, completed: true, value: true });
  assert.deepEqual(september, { applicable: true, completed: false, value: false });
});

test('7 — non-default period without fact does not use legacy profile flag', () => {
  const cell = resolveMaterialBroughtForPeriod({
    period_fact: undefined,
    has_period_fact: false,
    legacy_profile_flag: true,
    operational_period_key: '2026-08',
    default_period_key: '2026-09',
    vat_applicable: true,
  });
  assert.deepEqual(cell, { applicable: true, completed: false, value: false });
});

test('8 — NOT APPLICABLE material is not encoded as false', () => {
  const cell = resolveMaterialBroughtForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-09',
    default_period_key: '2026-09',
    vat_applicable: false,
  });
  assert.deepEqual(cell, { applicable: false, completed: null, value: null });
});

test('9 — frozen snapshot inputs: Sep monthly vs bi diverge (historical stability model)', () => {
  const sepMonthly = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({ vat_frequency: 'monthly' }),
  );
  const sepBi = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({ vat_frequency: 'bi_monthly' }),
  );
  assert.equal(sepMonthly.vat_applicable, true);
  assert.equal(sepBi.vat_applicable, false);
});

test('10 — client created after period excluded', () => {
  assert.equal(
    clientExistsInOperationalPeriod({
      client_created_at: '2026-10-01T00:00:00.000Z',
      operational_period_key: '2026-09',
    }),
    false,
  );
  assert.equal(
    clientExistsInOperationalPeriod({
      client_created_at: '2026-09-01T00:00:00.000Z',
      operational_period_key: '2026-09',
    }),
    true,
  );
});

test('11 — deductions bi-monthly uses odd operational months', () => {
  const biOdd = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({
      vat_frequency: 'not_relevant',
      vat_type: 'no',
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'bi_monthly',
    }),
  );
  const biEven = computeOperationalPeriodApplicability(
    '2026-10',
    baseInputs({
      vat_frequency: 'not_relevant',
      vat_type: 'no',
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'bi_monthly',
    }),
  );
  assert.equal(biOdd.income_tax_deductions_applicable, true);
  assert.equal(biEven.income_tax_deductions_applicable, false);
});

test('12 — NI fail-closed without canonical facts', () => {
  const closed = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({ vat_type: 'no', vat_frequency: 'not_relevant' }),
  );
  assert.equal(closed.national_insurance_applicable, false);
  assert.equal(closed.national_insurance_deductions_applicable, false);
  assert.equal(closed.row_visible, false);

  const open = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({
      vat_type: 'no',
      vat_frequency: 'not_relevant',
      national_insurance_type: 'yes',
      national_insurance_deductions_file_number: '123',
    }),
  );
  assert.equal(open.national_insurance_applicable, true);
  assert.equal(open.national_insurance_deductions_applicable, true);
  assert.equal(open.row_visible, true);
});

test('13 — available periods include default + known only', () => {
  assert.deepEqual(
    buildAvailableOperationalPeriods({
      default_period_key: '2026-09',
      known_period_keys: ['2026-08', 'bogus', '2026-09'],
    }),
    ['2026-08', '2026-09'],
  );
});

test('14 — FE has no applicability math / no month tabs; passes operational_period_key', () => {
  const view = readFileSync(
    join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const page = readFileSync(join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.doesNotMatch(view, /computeOperationalPeriodApplicability|isVatBiMonthlyApplicable/);
  assert.doesNotMatch(page, /08\.26|monthTabs|operationalMonths\s*=/);
  assert.match(view, /operational_period_key/);
  assert.match(view, /material_brought_flag === null/);
});

test('15 — command returns same-period aggregate (source contract)', () => {
  const custom = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
    'utf8',
  );
  assert.match(custom, /set_material_brought/);
  assert.match(custom, /upsertPeriodMaterialFact/);
  assert.match(custom, /responseQuery\.operational_period_key/);
  assert.match(custom, /listClientOperationsRegistry\(ctx,\s*responseQuery\)/);
});

test('16 — advances bi-monthly uses odd operational months (same CO filing vocabulary)', () => {
  const biOdd = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({
      vat_frequency: 'not_relevant',
      vat_type: 'no',
      income_tax_advance_enabled: true,
      income_tax_advance_frequency: 'bi_monthly',
    }),
  );
  const biEven = computeOperationalPeriodApplicability(
    '2026-10',
    baseInputs({
      vat_frequency: 'not_relevant',
      vat_type: 'no',
      income_tax_advance_enabled: true,
      income_tax_advance_frequency: 'bi_monthly',
    }),
  );
  assert.equal(biOdd.income_tax_advance_applicable, true);
  assert.equal(biEven.income_tax_advance_applicable, false);
});

test('17 — archived client: current/default excludes; historical frozen membership includes', () => {
  assert.equal(
    shouldIncludeArchivedClientInOperationalPeriodRegistry({
      is_current_or_default_period: true,
      is_archived: true,
      has_frozen_period_membership: true,
    }),
    false,
  );
  assert.equal(
    shouldIncludeArchivedClientInOperationalPeriodRegistry({
      is_current_or_default_period: false,
      is_archived: true,
      has_frozen_period_membership: true,
    }),
    true,
  );
  assert.equal(
    shouldIncludeArchivedClientInOperationalPeriodRegistry({
      is_current_or_default_period: false,
      is_archived: true,
      has_frozen_period_membership: false,
    }),
    false,
  );
  assert.equal(
    shouldIncludeArchivedClientInOperationalPeriodRegistry({
      is_current_or_default_period: false,
      is_archived: false,
      has_frozen_period_membership: false,
    }),
    true,
  );
});

test('18 — historical archived membership wiring (Aug snapshot → archive → Aug still visible)', () => {
  const service = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  assert.match(service, /loadPeriodMembershipClientIds/);
  assert.match(service, /shouldIncludeArchivedClientInOperationalPeriodRegistry/);
  assert.match(service, /Never invent historical applicability for archived clients/);
  assert.match(service, /clientExistsInOperationalPeriod/);
  // Live/default path still scopes to non-archived.
  assert.match(service, /\.eq\('is_archived',\s*false\)/);
});

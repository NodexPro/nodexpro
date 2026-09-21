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
  resolveDefaultOperationalPeriodKey,
  clientExistsInOperationalPeriod,
  computeOperationalPeriodApplicability,
  isVatBiMonthlyApplicableForOperationalPeriod,
  isVatMonthlyApplicableForOperationalPeriod,
  isVatPaturApplicableForOperationalPeriod,
  resolveMaterialBroughtForPeriod,
  resolveVatApplicabilityForOperationalPeriod,
  shouldIncludeArchivedClientInOperationalPeriodRegistry,
  shouldEmitOperationalPeriodRegistryRow,
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

test('14 — FE has no applicability math; period tabs are presentation-only; passes operational_period_key', () => {
  const view = readFileSync(
    join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const page = readFileSync(join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.doesNotMatch(view, /computeOperationalPeriodApplicability|isVatBiMonthlyApplicable/);
  assert.doesNotMatch(page, /operationalMonths\s*=/);
  assert.match(view, /operational_period_key/);
  assert.match(view, /ClientOperationsPeriodSheetTabs|material_brought_cell/);
  assert.match(page, /available_periods|onPeriodChange/);
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

test('D1 — default workspace period is previous Jerusalem month (Sep 2026 -> 2026-08)', () => {
  // 2026-09-21 12:00 Asia/Jerusalem = 2026-09-21 09:00 UTC
  const now = new Date('2026-09-21T09:00:00.000Z');
  assert.equal(resolveDefaultOperationalPeriodKey(now), '2026-08');
});

test('D2 — default workspace period year boundary (Jan 2027 -> 2026-12)', () => {
  // 2027-01-10 12:00 Asia/Jerusalem = 2027-01-10 10:00 UTC (IST+2 winter? Jan is IST+2)
  const now = new Date('2027-01-10T10:00:00.000Z');
  assert.equal(resolveDefaultOperationalPeriodKey(now), '2026-12');
});

test('D3 — VAT bi-monthly: workspace 2026-08 applicable; 2026-09 not applicable', () => {
  assert.equal(isVatBiMonthlyApplicableForOperationalPeriod('2026-08'), true);
  assert.equal(isVatBiMonthlyApplicableForOperationalPeriod('2026-09'), false);
  assert.equal(
    resolveVatApplicabilityForOperationalPeriod({
      vat_type: 'yes',
      vat_frequency: 'bi_monthly',
      operational_period_key: '2026-08',
    }),
    true,
  );
  assert.equal(
    resolveVatApplicabilityForOperationalPeriod({
      vat_type: 'yes',
      vat_frequency: 'bi_monthly',
      operational_period_key: '2026-09',
    }),
    false,
  );
});

test('D4 — available_periods always includes default even when only 2026-09 known', () => {
  assert.deepEqual(
    buildAvailableOperationalPeriods({
      default_period_key: '2026-08',
      known_period_keys: ['2026-09'],
    }),
    ['2026-08', '2026-09'],
  );
});

test('D5 — material 2026-08 and 2026-09 remain independent facts', () => {
  const aug = resolveMaterialBroughtForPeriod({
    period_fact: true,
    has_period_fact: true,
    legacy_profile_flag: false,
    operational_period_key: '2026-08',
    default_period_key: '2026-08',
    vat_applicable: true,
  });
  const sep = resolveMaterialBroughtForPeriod({
    period_fact: false,
    has_period_fact: true,
    legacy_profile_flag: true,
    operational_period_key: '2026-09',
    default_period_key: '2026-08',
    vat_applicable: true,
  });
  assert.deepEqual(aug, { applicable: true, completed: true, value: true });
  assert.deepEqual(sep, { applicable: true, completed: false, value: false });
});

test('D6 — registry resolver: omitted key uses default; explicit 2026-09 preserved (source)', () => {
  const service = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-operational-period.service.ts'),
    'utf8',
  );
  assert.match(service, /resolveDefaultOperationalPeriodKey/);
  assert.match(service, /if \(requested == null \|\| requested === ''\) return defaultKey/);
  assert.match(service, /return requested/);
});

test('M1 — active bi-monthly VAT: 08 applicable; 09 N/A but row still emitted', () => {
  const aug = computeOperationalPeriodApplicability(
    '2026-08',
    baseInputs({ vat_frequency: 'bi_monthly' }),
  );
  const sep = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({ vat_frequency: 'bi_monthly' }),
  );
  assert.equal(aug.vat_applicable, true);
  assert.equal(aug.row_visible, true);
  assert.equal(sep.vat_applicable, false);
  assert.equal(sep.row_visible, false);
  // Membership ignores row_visible:
  assert.equal(
    shouldEmitOperationalPeriodRegistryRow({
      is_archived: false,
      has_applicability_snapshot: true,
      has_material_fact: false,
      snapshot_row_visible: sep.row_visible,
    }),
    true,
  );
});

test('M2 — active patur-only: Nov N/A row kept; Dec VAT applicable', () => {
  const nov = computeOperationalPeriodApplicability(
    '2026-11',
    baseInputs({ vat_type: 'patur', vat_frequency: 'not_relevant' }),
  );
  const dec = computeOperationalPeriodApplicability(
    '2026-12',
    baseInputs({ vat_type: 'patur', vat_frequency: 'not_relevant' }),
  );
  assert.equal(nov.vat_applicable, false);
  assert.equal(nov.row_visible, false);
  assert.equal(dec.vat_applicable, true);
  assert.equal(
    shouldEmitOperationalPeriodRegistryRow({
      is_archived: false,
      has_applicability_snapshot: true,
      has_material_fact: false,
      snapshot_row_visible: false,
    }),
    true,
  );
});

test('M3 — active client with zero applicable streams still emits registry row', () => {
  const r = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({ vat_type: 'no', vat_frequency: 'not_relevant' }),
  );
  assert.equal(r.row_visible, false);
  assert.equal(
    shouldEmitOperationalPeriodRegistryRow({
      is_archived: false,
      has_applicability_snapshot: true,
      has_material_fact: false,
      snapshot_row_visible: false,
    }),
    true,
  );
});

test('M4 — created-after-period excluded; archived needs frozen evidence', () => {
  assert.equal(
    clientExistsInOperationalPeriod({
      client_created_at: '2026-10-01T00:00:00.000Z',
      operational_period_key: '2026-08',
    }),
    false,
  );
  assert.equal(
    shouldEmitOperationalPeriodRegistryRow({
      is_archived: true,
      has_applicability_snapshot: true,
      has_material_fact: false,
      snapshot_row_visible: false,
    }),
    true,
  );
  assert.equal(
    shouldEmitOperationalPeriodRegistryRow({
      is_archived: true,
      has_applicability_snapshot: false,
      has_material_fact: true,
      snapshot_row_visible: null,
    }),
    true,
  );
  assert.equal(
    shouldEmitOperationalPeriodRegistryRow({
      is_archived: true,
      has_applicability_snapshot: false,
      has_material_fact: false,
      snapshot_row_visible: null,
    }),
    false,
  );
});

test('M5 — material N/A when VAT not applicable; independent of row emission', () => {
  const cell = resolveMaterialBroughtForPeriod({
    period_fact: true,
    has_period_fact: true,
    legacy_profile_flag: true,
    operational_period_key: '2026-09',
    default_period_key: '2026-08',
    vat_applicable: false,
  });
  assert.deepEqual(cell, { applicable: false, completed: null, value: null });
});

test('M6 — service no longer gates membership on snapshot.row_visible (source)', () => {
  const service = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  assert.match(service, /shouldEmitOperationalPeriodRegistryRow/);
  assert.doesNotMatch(service, /if \(!snapshot\.row_visible\) return \[\]/);
  assert.match(service, /Registry membership != cell applicability/);
});

test('M7 — default vs explicit same period: resolver does not branch membership (source)', () => {
  const service = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  // Default only chooses selected period; membership path must not special-case default.
  assert.match(service, /isCurrentOrDefaultPeriod/);
  assert.doesNotMatch(
    service,
    /isCurrentOrDefaultPeriod[\s\S]{0,200}row_visible/,
  );
});


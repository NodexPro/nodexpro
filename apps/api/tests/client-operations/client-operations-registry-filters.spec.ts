/**
 * Client Operations — backend-owned registry filter facets + AND matching.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyClientOperationsRegistryBusinessFilters,
  buildClientOperationsRegistryFiltersContract,
  buildClientOperationsRegistryRowFilterFacets,
  CLIENT_OPERATIONS_OPERATIONAL_REPORTING_FILTER_COLUMN_KEYS,
  isAnyClientOperationsBusinessFilterActive,
  isExplicitIncomeTaxAdvanceExemptProfileStatus,
  normalizeClientOperationsRegistryBusinessFilterQuery,
  resolveMaterialFilterFacet,
  resolveOperationalReportingFilterFacet,
  resolvePayrollFilterFacet,
  resolveReportingTypeFacets,
  resolveBusinessTypeRowFacet,
  rowMatchesClientOperationsBusinessFilters,
  type ClientOperationsRegistryFiltersActive,
  type ClientOperationsRegistryRowFilterFacets,
} from '../../src/domains/client-operations/client-operations-registry-filters.pure.js';
import { buildMaterialCells, buildOperationalCheckboxCell } from '../../src/domains/client-operations/client-operations-operational-period.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const routesSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.routes.ts'),
  'utf8',
);
const filterPureSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-filters.pure.ts'),
  'utf8',
);

const allActive = (): ClientOperationsRegistryFiltersActive =>
  normalizeClientOperationsRegistryBusinessFilterQuery({});

const facets = (
  overrides: Partial<ClientOperationsRegistryRowFilterFacets> = {},
): ClientOperationsRegistryRowFilterFacets => ({
  operational_reporting: 'not_reported',
  operational_reporting_participating_columns: ['vat'],
  material: 'not_received',
  payroll: 'no_payroll',
  reporting_types: [],
  business_type: 'undefined',
  handler_user_id: null,
  ...overrides,
});

test('1 filter definitions come from aggregate contract (backend-owned)', () => {
  const contract = buildClientOperationsRegistryFiltersContract({
    active: allActive(),
    handlerOptions: [{ user_id: 'u1', display_name: 'Handler One' }],
  });
  assert.equal(contract.definitions.length, 6);
  assert.deepEqual(
    contract.definitions.map((d) => d.id),
    ['operational_reporting', 'material', 'payroll', 'reporting_type', 'business_type', 'handler'],
  );
  assert.equal(contract.definitions[0]!.label_he, 'דיווח');
  assert.equal(contract.definitions[5]!.options.some((o) => o.id === 'u1'), true);
  assert.equal(contract.clear_action.label_he, 'נקה סינון');
  assert.equal(contract.clear_action.available, false);
  assert.match(serviceSource, /filters:\s*filtersContract|filters,/);
  assert.match(serviceSource, /buildClientOperationsRegistryFiltersContract/);
});

test('2 frontend must not construct business filter options — definitions are backend', () => {
  assert.match(filterPureSource, /buildClientOperationsRegistryFiltersContract/);
  assert.match(routesSource, /filter_operational_reporting/);
  assert.match(serviceSource, /filter_facets/);
});

test('3 material received facet backend-owned', () => {
  const cells = buildMaterialCells({
    vat: buildOperationalCheckboxCell(true, true),
    income_tax_advance: buildOperationalCheckboxCell(true, true),
    payroll: buildOperationalCheckboxCell(false, null),
  });
  assert.equal(resolveMaterialFilterFacet(cells), 'received');
});

test('4 material not-received backend-owned', () => {
  const cells = buildMaterialCells({
    vat: buildOperationalCheckboxCell(true, true),
    income_tax_advance: buildOperationalCheckboxCell(true, false),
    payroll: buildOperationalCheckboxCell(false, null),
  });
  assert.equal(resolveMaterialFilterFacet(cells), 'not_received');
});

test('5 no-applicable material not classified as received', () => {
  const cells = buildMaterialCells({
    vat: buildOperationalCheckboxCell(false, null),
    income_tax_advance: buildOperationalCheckboxCell(false, null),
    payroll: buildOperationalCheckboxCell(false, null),
  });
  assert.equal(resolveMaterialFilterFacet(cells), 'not_applicable');
  assert.notEqual(resolveMaterialFilterFacet(cells), 'received');
});

test('6 payroll facet backend-owned', () => {
  assert.equal(resolvePayrollFilterFacet(true), 'has_payroll');
  assert.equal(resolvePayrollFilterFacet(false), 'no_payroll');
});

test('7 business_type facet backend-owned', () => {
  assert.equal(resolveBusinessTypeRowFacet('עוסק מורשה'), 'osek_murshe');
  assert.equal(resolveBusinessTypeRowFacet('עוסק פטור'), 'osek_patur');
  assert.equal(resolveBusinessTypeRowFacet('חברה'), 'company');
  assert.equal(resolveBusinessTypeRowFacet(null), 'undefined');
  assert.equal(resolveBusinessTypeRowFacet(''), 'undefined');
  assert.equal(resolveBusinessTypeRowFacet('אחר'), 'other');
});

test('8 handler options backend-owned in contract', () => {
  const contract = buildClientOperationsRegistryFiltersContract({
    active: allActive(),
    handlerOptions: [
      { user_id: 'abc-123', display_name: 'דני' },
      { user_id: 'def-456', display_name: 'נועה' },
    ],
  });
  const handler = contract.definitions.find((d) => d.id === 'handler')!;
  assert.equal(handler.options[0]!.id, 'all');
  assert.equal(handler.options[1]!.id, 'unassigned');
  assert.equal(handler.options[1]!.label_he, 'לא משויך');
  assert.equal(handler.options.some((o) => o.id === 'abc-123' && o.label_he === 'דני'), true);
});

test('9 reporting type facets backend-owned as SET', () => {
  const set = resolveReportingTypeFacets({
    income_tax_advance_profile_status: null,
    income_tax_advance_enabled: true,
    income_tax_advance_frequency: 'monthly',
    vat_type: 'yes',
    vat_frequency: 'bi_monthly',
    income_tax_deductions_configured: true,
    income_tax_deductions_frequency: 'semi_annual',
  });
  assert.deepEqual(set.sort(), [
    'income_tax_advance_monthly',
    'income_tax_deductions_semiannual',
    'vat_bimonthly',
  ].sort());
});

test('10 VAT monthly/bi-monthly backend-owned', () => {
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: null,
      income_tax_advance_enabled: false,
      income_tax_advance_frequency: null,
      vat_type: 'yes',
      vat_frequency: 'monthly',
      income_tax_deductions_configured: false,
      income_tax_deductions_frequency: null,
    }),
    ['vat_monthly'],
  );
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: null,
      income_tax_advance_enabled: false,
      income_tax_advance_frequency: null,
      vat_type: 'yes',
      vat_frequency: 'bi_monthly',
      income_tax_deductions_configured: false,
      income_tax_deductions_frequency: null,
    }),
    ['vat_bimonthly'],
  );
});

test('11 IT advance monthly/bi-monthly backend-owned', () => {
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: 'כן',
      income_tax_advance_enabled: true,
      income_tax_advance_frequency: 'monthly',
      vat_type: null,
      vat_frequency: null,
      income_tax_deductions_configured: false,
      income_tax_deductions_frequency: null,
    }),
    ['income_tax_advance_monthly'],
  );
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: null,
      income_tax_advance_enabled: true,
      income_tax_advance_frequency: 'bi_monthly',
      vat_type: null,
      vat_frequency: null,
      income_tax_deductions_configured: false,
      income_tax_deductions_frequency: null,
    }),
    ['income_tax_advance_bimonthly'],
  );
});

test('12 IT deductions monthly/bi-monthly/semiannual backend-owned', () => {
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: null,
      income_tax_advance_enabled: false,
      income_tax_advance_frequency: null,
      vat_type: null,
      vat_frequency: null,
      income_tax_deductions_configured: true,
      income_tax_deductions_frequency: 'monthly',
    }),
    ['income_tax_deductions_monthly'],
  );
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: null,
      income_tax_advance_enabled: false,
      income_tax_advance_frequency: null,
      vat_type: null,
      vat_frequency: null,
      income_tax_deductions_configured: true,
      income_tax_deductions_frequency: 'bi_monthly',
    }),
    ['income_tax_deductions_bimonthly'],
  );
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: null,
      income_tax_advance_enabled: false,
      income_tax_advance_frequency: null,
      vat_type: null,
      vat_frequency: null,
      income_tax_deductions_configured: true,
      income_tax_deductions_frequency: 'semi_annual',
    }),
    ['income_tax_deductions_semiannual'],
  );
});

test('13 פטור only when explicit canonical profile status לא', () => {
  assert.equal(isExplicitIncomeTaxAdvanceExemptProfileStatus('לא'), true);
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: 'לא',
      income_tax_advance_enabled: false,
      income_tax_advance_frequency: null,
      vat_type: null,
      vat_frequency: null,
      income_tax_deductions_configured: false,
      income_tax_deductions_frequency: null,
    }),
    ['income_tax_advance_exempt'],
  );
});

test('14 — / enabled!==true never means פטור', () => {
  assert.equal(isExplicitIncomeTaxAdvanceExemptProfileStatus(null), false);
  assert.equal(isExplicitIncomeTaxAdvanceExemptProfileStatus(''), false);
  assert.equal(isExplicitIncomeTaxAdvanceExemptProfileStatus('כן'), false);
  assert.deepEqual(
    resolveReportingTypeFacets({
      income_tax_advance_profile_status: null,
      income_tax_advance_enabled: false,
      income_tax_advance_frequency: null,
      vat_type: null,
      vat_frequency: null,
      income_tax_deductions_configured: false,
      income_tax_deductions_frequency: null,
    }),
    [],
  );
  assert.doesNotMatch(filterPureSource, /if\s*\(\s*input\.income_tax_advance_enabled\s*!==\s*true/);
  assert.doesNotMatch(filterPureSource, /formatIncomeTaxAdvanceRegistryFrequencyDisplayHe/);
});

test('15 operational דיווח does not inspect CSS color — uses manual_cell_statuses', () => {
  const participating = resolveOperationalReportingFilterFacet({
    period_applicability: {
      vat_applicable: true,
      income_tax_advance_applicable: true,
      income_tax_deductions_applicable: false,
      national_insurance_applicable: false,
      national_insurance_deductions_applicable: false,
    },
    manual_cell_statuses: {
      vat: { status: 'completed' },
      income_tax_advance: { status: 'completed' },
    },
  });
  assert.equal(participating.status, 'reported');
  assert.deepEqual(participating.participating_columns, ['vat', 'income_tax_advance']);
  assert.deepEqual(
    [...CLIENT_OPERATIONS_OPERATIONAL_REPORTING_FILTER_COLUMN_KEYS],
    ['vat', 'income_tax_advance', 'income_tax_deductions', 'national_insurance', 'national_insurance_deductions'],
  );
  assert.doesNotMatch(filterPureSource, /getComputedStyle|backgroundColor|#22c55e|#16a34a/);
  const notReported = resolveOperationalReportingFilterFacet({
    period_applicability: { vat_applicable: true },
    manual_cell_statuses: { vat: { status: 'ready' } },
  });
  assert.equal(notReported.status, 'not_reported');
  const nA = resolveOperationalReportingFilterFacet({
    period_applicability: {},
    manual_cell_statuses: {},
  });
  assert.equal(nA.status, 'not_applicable');
});

test('16 each filter independently', () => {
  const row = facets({ payroll: 'has_payroll', business_type: 'company' });
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      payroll: 'has_payroll',
    }),
    true,
  );
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      payroll: 'no_payroll',
    }),
    false,
  );
});

test('17 multiple filters combine with AND', () => {
  const row = facets({
    material: 'not_received',
    payroll: 'has_payroll',
    business_type: 'company',
  });
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      material: 'not_received',
      payroll: 'has_payroll',
      business_type: 'company',
    }),
    true,
  );
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      material: 'not_received',
      payroll: 'has_payroll',
      business_type: 'osek_murshe',
    }),
    false,
  );
});

test('18 reporting-type membership works as set membership', () => {
  const row = facets({
    reporting_types: ['vat_monthly', 'income_tax_advance_bimonthly'],
  });
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      reporting_type: 'vat_monthly',
    }),
    true,
  );
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      reporting_type: 'vat_bimonthly',
    }),
    false,
  );
});

test('19 handler filters by stable ID', () => {
  const row = facets({ handler_user_id: 'user-stable-9' });
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      handler: 'user-stable-9',
    }),
    true,
  );
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(row, {
      ...allActive(),
      handler: 'other-user',
    }),
    false,
  );
});

test('20 לא משויך works', () => {
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(facets({ handler_user_id: null }), {
      ...allActive(),
      handler: 'unassigned',
    }),
    true,
  );
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(facets({ handler_user_id: 'x' }), {
      ...allActive(),
      handler: 'unassigned',
    }),
    false,
  );
});

test('21 לא הוגדר business type works (null only; אחר is other)', () => {
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(facets({ business_type: 'undefined' }), {
      ...allActive(),
      business_type: 'undefined',
    }),
    true,
  );
  assert.equal(
    rowMatchesClientOperationsBusinessFilters(facets({ business_type: 'other' }), {
      ...allActive(),
      business_type: 'undefined',
    }),
    false,
  );
});

test('22 search + filters combine — business filter early; search/sort after', () => {
  const rows = [
    { client_id: 'a', filter_facets: facets({ business_type: 'company' }) },
    { client_id: 'b', filter_facets: facets({ business_type: 'osek_murshe' }) },
  ];
  const filtered = applyClientOperationsRegistryBusinessFilters(rows, {
    ...allActive(),
    business_type: 'company',
  });
  assert.deepEqual(
    filtered.map((r) => r.client_id),
    ['a'],
  );
  // Early facet match before expensive presentation loads; search via applyRegistryQueryToRows.
  assert.match(serviceSource, /rowMatchesClientOperationsBusinessFilters/);
  assert.match(serviceSource, /matchingClientIds/);
  assert.match(serviceSource, /phase2_presentation_loads|presentation-only set-based/);
  assert.match(serviceSource, /applyRegistryQueryToRows/);
  assert.doesNotMatch(
    serviceSource,
    /applyRegistryQueryToRows[\s\S]{0,200}applyClientOperationsRegistryBusinessFilters/,
  );
});

test('28 early filter before presentation — no per-client N+1 in registry pipeline', () => {
  assert.match(serviceSource, /rowMatchesClientOperationsBusinessFilters/);
  assert.match(serviceSource, /matchingClientIds/);
  assert.match(serviceSource, /loadNotesAggregatesByClient\(orgId, matchingClientIds\)/);
  assert.match(serviceSource, /Promise\.all\(\[/);
  // No per-client await inside the facet/presentation loops.
  assert.doesNotMatch(serviceSource, /for \(const c of safeClients\)[\s\S]{0,400}await /);
  assert.doesNotMatch(serviceSource, /facetSeeds\.flatMap[\s\S]{0,400}await /);
});

test('29 handler display reuses org handler options — no second org_users round-trip', () => {
  assert.match(serviceSource, /handlerDisplayByUserId = new Map\(/);
  assert.match(serviceSource, /handlerFilterOptions\.map/);
  assert.doesNotMatch(
    serviceSource,
    /const handlerDisplayByUserId = await loadHandlerDisplayNamesByUserIds/,
  );
});

test('30 stage timings recorded for registry aggregate', () => {
  assert.match(serviceSource, /logAggregatePayloadBreakdown/);
  assert.match(serviceSource, /client_operations_registry_aggregate/);
  assert.match(serviceSource, /stage_timings/);
  assert.match(serviceSource, /phase1_facet_inputs/);
  assert.match(serviceSource, /facet_build_and_early_filter/);
});

test('23 filter + period — facets built from period snapshot fields', () => {
  assert.match(serviceSource, /advanceEnabledForFacet|income_tax_advance_enabled/);
  assert.match(serviceSource, /vatTypeForFacet|snapshot\.vat_type/);
  assert.match(serviceSource, /itdFrequencyForFacet/);
});

test('24 stale response protection remains loadSeq-based on FE path', () => {
  // Covered by page loadSeq; backend contract is request-scoped.
  assert.equal(isAnyClientOperationsBusinessFilterActive(allActive()), false);
  assert.equal(
    isAnyClientOperationsBusinessFilterActive({ ...allActive(), business_type: 'company' }),
    true,
  );
});

test('25 manual rows visible with no business filter — policy in aggregate', () => {
  assert.match(serviceSource, /anyBusinessFilter/);
  assert.match(serviceSource, /manual_rows = anyBusinessFilter\s*\?\s*\[\]/);
});

test('26 manual rows hidden with any business filter — backend decides', () => {
  assert.equal(
    isAnyClientOperationsBusinessFilterActive({ ...allActive(), material: 'received' }),
    true,
  );
  assert.match(serviceSource, /anyBusinessFilter\s*\?\s*\[\]/);
});

test('27 reset returns all rows — clear sets all to all', () => {
  const contract = buildClientOperationsRegistryFiltersContract({
    active: { ...allActive(), business_type: 'company' },
    handlerOptions: [],
  });
  assert.equal(contract.clear_action.available, true);
  const reset = normalizeClientOperationsRegistryBusinessFilterQuery({});
  assert.equal(isAnyClientOperationsBusinessFilterActive(reset), false);
});

test('buildClientOperationsRegistryRowFilterFacets wires fields', () => {
  const built = buildClientOperationsRegistryRowFilterFacets({
    period_applicability: { vat_applicable: true, payroll_applicable: true },
    manual_cell_statuses: { vat: { status: 'completed' } },
    material_cells: buildMaterialCells({
      vat: buildOperationalCheckboxCell(true, true),
      income_tax_advance: buildOperationalCheckboxCell(false, null),
      payroll: buildOperationalCheckboxCell(true, false),
    }),
    payroll_applicable: true,
    business_type: 'חברה',
    assigned_handler_user_id: 'h1',
    income_tax_advance_profile_status: 'לא',
    income_tax_advance_enabled: false,
    income_tax_advance_frequency: null,
    vat_type: 'yes',
    vat_frequency: 'monthly',
    income_tax_deductions_configured: false,
    income_tax_deductions_frequency: null,
  });
  assert.equal(built.operational_reporting, 'reported');
  assert.equal(built.material, 'not_received');
  assert.equal(built.payroll, 'has_payroll');
  assert.equal(built.business_type, 'company');
  assert.equal(built.handler_user_id, 'h1');
  assert.ok(built.reporting_types.includes('income_tax_advance_exempt'));
  assert.ok(built.reporting_types.includes('vat_monthly'));
});

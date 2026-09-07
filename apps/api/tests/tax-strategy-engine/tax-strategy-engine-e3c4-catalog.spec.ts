import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleStrategyEngineSlice,
  emptyStrategyPinCatalog,
  mapCalculationDefinitionVersionCatalogRow,
} from '../../src/domains/tax-strategy-engine/tax-strategy-engine-read-models.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-E3C4 catalog: pin_catalog lives on strategy_engine same-GET slice', () => {
  const slice = assembleStrategyEngineSlice({
    selectedCountryCode: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    exclusiveGroups: [],
    strategies: [],
    strategyVersions: [],
    warnings: [],
  });
  assert.deepEqual(slice.pin_catalog, emptyStrategyPinCatalog());
  assert.deepEqual(slice.pin_catalog.calculation_definition_versions, []);

  const row = mapCalculationDefinitionVersionCatalogRow(
    {
      id: 'cv-old',
      tax_calculation_definition_id: 'cd-1',
      version_no: 1,
      status: 'retired',
      effective_from: '2020-01-01',
      effective_to: '2020-12-31',
    },
    { calculation_code: 'DEP', title: 'Depreciation' },
  );
  assert.deepEqual(row, {
    id: 'cv-old',
    tax_calculation_definition_id: 'cd-1',
    calculation_code: 'DEP',
    title: 'Depreciation',
    version_no: 1,
    status: 'retired',
    effective_from: '2020-01-01',
    effective_to: '2020-12-31',
  });

  const withCatalog = assembleStrategyEngineSlice({
    selectedCountryCode: 'IL',
    countries: [],
    exclusiveGroups: [],
    strategies: [],
    strategyVersions: [],
    pinCatalog: { calculation_definition_versions: [row] },
    warnings: [],
  });
  assert.equal(withCatalog.pin_catalog.calculation_definition_versions[0]?.id, 'cv-old');
  assert.equal(withCatalog.pin_catalog.calculation_definition_versions[0]?.version_no, 1);
});

test('TAX-E3C4 catalog: country-scoped exact versions, no latest/AST/new GET/613', () => {
  const service = readRepo(
    'apps/api/src/domains/tax-strategy-engine/owner-read/tax-strategy-engine-read-models.service.ts',
  );
  const pure = readRepo('apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-read-models.pure.ts');
  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  const endpoints = readRepo('apps/web/src/api/endpoints.ts');

  assert.match(service, /loadCalculationDefinitionVersionCatalog/);
  assert.match(service, /pinCatalog: \{ calculation_definition_versions: calculationDefinitionVersions \}/);
  assert.match(service, /\.from\('tax_calculation_definition_versions'\)/);
  assert.match(service, /\.from\('tax_calculation_definitions'\)/);
  assert.match(service, /CALC_CATALOG_VERSION_SELECT/);
  assert.match(service, /id, tax_calculation_definition_id, version_no, status, effective_from, effective_to/);
  assert.match(service, /CALC_CATALOG_DEFINITION_SELECT = 'id, calculation_code, title'/);
  assert.match(service, /\.eq\('country_code', countryCode\)/);
  assert.match(service, /isSupabaseMissingTableError\(versionError, 'tax_calculation_definition_versions'\)/);
  assert.match(service, /isSupabaseMissingTableError\(definitionError, 'tax_calculation_definitions'\)/);
  assert.doesNotMatch(service, /expression_json|definition_checksum|expression_checksum|legal_value|run_result|expression_ast/);
  assert.doesNotMatch(service, /latest_version|resolveLatest|current_active|newest/);
  assert.doesNotMatch(pure, /latest_version|resolveLatest|current_active/);
  assert.match(pure, /pin_catalog: input\.pinCatalog \?\? emptyStrategyPinCatalog\(\)/);
  assert.match(routes, /router\.get\('\/legal-control'/);
  assert.doesNotMatch(routes, /router\.get\('\/strategy-engine'|router\.get\('\/calculations'/);
  assert.doesNotMatch(endpoints, /strategy-engine|\/calculations/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_commands.sql')), false);
});

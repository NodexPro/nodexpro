import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const commands = readRepo('apps/api/src/domains/tax-advisory/tax-advisory-commands.service.ts');
const reads = readRepo('apps/api/src/domains/tax-advisory/tax-advisory-read-models.service.ts');
const routes = readRepo('apps/api/src/domains/tax-advisory/tax-advisory.routes.ts');
const catalog = readRepo('apps/api/src/domains/tax-advisory/tax-advisory-fact-catalog.service.ts');
const sql = readRepo('supabase/migrations/615_tax_advisory_case_foundation.sql');
const indexSrc = readRepo('apps/api/src/index.ts');

test('TAX-F2B1 adversarial: org/client/case IDOR guards and unauthenticated/module/RBAC', () => {
  assert.match(routes, /authMiddleware/);
  assert.match(routes, /requireOrg/);
  assert.match(routes, /requireModuleActive/);
  assert.match(routes, /requirePermission\(TAX_ADVISORY_PERMISSIONS\.view\)/);
  assert.match(routes, /requirePermission\(TAX_ADVISORY_PERMISSIONS\.edit\)/);
  assert.match(reads, /\.eq\('id', clientId\)/);
  assert.match(reads, /\.eq\('organization_id', orgId\)/);
  assert.match(reads, /\.eq\('id', caseId\)/);
  assert.match(reads, /\.eq\('organization_id', orgId\)/);
  assert.match(commands, /loadTaxAdvisoryClient\(orgId, clientId\)/);
  assert.match(commands, /loadTaxAdvisoryCaseForOrg\(orgId, caseId\)/);
  assert.match(commands, /if \(!client\) throw notFound/);
  assert.match(commands, /if \(!current\) throw notFound/);
  assert.match(sql, /organization_id in \(select public\.organizations_for_current_auth_user\(\)\)/);
});

test('TAX-F2B1 adversarial: country freeze, mismatch, one open case, archived no edits', () => {
  assert.match(commands, /requireOrgLegalCountry/);
  assert.match(commands, /assertClientCountryCompatibility/);
  assert.match(commands, /country_code: legalCountry/);
  assert.match(sql, /country_code are immutable/);
  assert.match(sql, /uq_tax_advisory_cases_one_open/);
  assert.match(commands, /OPEN_CASE_EXISTS/);
  assert.match(commands, /CASE_NOT_DRAFT/);
  assert.match(sql, /can only be written on a draft case/);
  assert.match(sql, /can only be cleared on a draft case/);
});

test('TAX-F2B1 adversarial: catalog rejects unknown/wrong-country/draft facts', () => {
  assert.match(catalog, /\.eq\('status', 'active'\)/);
  assert.match(catalog, /ownerFactDictionaryIncludesDefinitionCountry/);
  assert.match(commands, /FACT_NOT_IN_CATALOG/);
  assert.match(commands, /assertTaxFactAnswerValue/);
  assert.match(commands, /fact_definition_version_id: version\.id/);
  assert.doesNotMatch(commands, /latest_version|resolveLatest/);
});

test('TAX-F2B1 command returns full aggregate; no PATCH; no evaluate; no foreign writes', () => {
  assert.match(commands, /refreshed: await refresh/);
  assert.match(reads, /aggregate_key: TAX_ADVISORY_AGGREGATE_KEY/);
  assert.match(reads, /latest_evaluation: null/);
  assert.match(reads, /missing_facts_from_engine: null/);
  assert.match(reads, /scenarios: \[\]/);
  assert.doesNotMatch(commands, /router\.patch|method: 'PATCH'/);
  assert.doesNotMatch(indexSrc, /tax-advisory[\s\S]{0,80}patch/i);
  assert.doesNotMatch(commands, /evaluateTaxRules|runCalculateTax|evaluateTaxStrategies/);
  assert.doesNotMatch(commands, /tax_calculation_runs|intakeWorkEvent|accounting_entries/);
  assert.match(indexSrc, /\/api\/v1\/tax-advisory/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const PAGE = 'apps/web/src/pages/PlatformOwnerLegalControl.tsx';
const PANEL = 'apps/web/src/pages/owner-tax-knowledge-panel.tsx';
const TYPES = 'apps/web/src/pages/owner-legal-control-types.ts';
const ENDPOINTS = 'apps/web/src/api/endpoints.ts';
const APP = 'apps/web/src/App.tsx';

const KNOWLEDGE_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-K2B contract: same GET/POST, country query, no new route or endpoint', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);
  const app = readRepo(APP);

  assert.match(endpoints, /legalControl: '\/owner\/legal-control'/);
  assert.match(endpoints, /command: '\/owner\/command'/);
  assert.doesNotMatch(endpoints, /tax-knowledge/);
  assert.doesNotMatch(endpoints, /tax_knowledge/);

  assert.match(page, /tax_knowledge_country_code/);
  assert.match(page, /OWNER\.legalControl/);
  assert.match(page, /OWNER\.command/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /aggregate_key === 'owner_legal_control_panel_aggregate'/);
  assert.match(page, /OwnerTaxKnowledgePanel/);
  assert.doesNotMatch(page, /router\.(get|patch|put)/i);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/tax/);

  assert.match(panel, /create_tax_source/);
  assert.match(panel, /create_tax_rule/);
  assert.match(panel, /onCommand\('create_tax_source'/);
  assert.match(panel, /onCommand\('create_tax_rule'/);
  assert.match(panel, /selected_country_code/);
  assert.match(panel, /tax_knowledge_schema_not_applied/);
  assert.match(panel, /allowed_actions/);

  assert.match(app, /path="\/platform-owner\/legal-control"/);
  assert.doesNotMatch(app, /tax-knowledge/);
  assert.doesNotMatch(app, /TaxKnowledge/);
});

test('TAX-K2B contract: no K2C+ leakage, no frontend lifecycle inference', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const types = readRepo(TYPES);

  assert.doesNotMatch(panel, /create_tax_rule_relationship|supersede_tax_rule_version/);
  assert.doesNotMatch(panel, /activate_tax_rule_version|retire_tax_rule_version|close_tax_rule_version_effective_to/);
  assert.doesNotMatch(panel, /latest.?version|superseded_by_version_id/i);
  assert.doesNotMatch(panel, /ensureCountryPackAndRulesetForCountry/);
  assert.doesNotMatch(page, /ensureCountryPackAndRulesetForCountry\(\s*taxKnowledge/);

  assert.match(types, /export type TaxKnowledgeAggregate/);
  assert.match(types, /export type TaxKnowledgeSource/);
  assert.match(types, /export type TaxKnowledgeRule/);
  assert.doesNotMatch(types, /superseded_by_version_id/);
  assert.doesNotMatch(types, /version retired_at/);
});

test('TAX-K2B contract: create eligibility and provenance_type are not frontend domain rules', () => {
  const panel = readRepo(PANEL);

  assert.match(panel, /createSourceAllowed = createSourceAction\?\.enabled === true/);
  assert.match(panel, /createRuleAllowed = createRuleAction\?\.enabled === true/);
  assert.match(panel, /disabled=\{busy \|\| !createSourceAllowed\}/);
  assert.match(panel, /disabled=\{busy \|\| !createRuleAllowed\}/);
  assert.doesNotMatch(panel, /enabled && selectedCountryCode/);
  assert.doesNotMatch(panel, /canCreateSource|canCreateRule|provenanceOptionsFromAction/);
  assert.doesNotMatch(panel, /split\('\|'\)/);
  assert.doesNotMatch(panel, /TAX_SOURCE_PROVENANCE_TYPES/);
  assert.match(panel, /className="nx-input"\s*\n\s*value=\{sourceForm\.provenance_type\}/);
});

test('TAX-K2B contract: Tax Knowledge migrations and backend production files unchanged', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  const lockedBackend = [
    'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge-checksum.pure.ts',
    'apps/api/src/routes/owner-country-pack.routes.ts',
  ];
  for (const file of lockedBackend) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
});

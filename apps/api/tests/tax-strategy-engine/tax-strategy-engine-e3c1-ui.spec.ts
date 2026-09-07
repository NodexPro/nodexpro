import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const PAGE = 'apps/web/src/pages/PlatformOwnerLegalControl.tsx';
const PANEL = 'apps/web/src/pages/owner-strategy-engine-panel.tsx';
const TK_PANEL = 'apps/web/src/pages/owner-tax-knowledge-panel.tsx';
const TYPES = 'apps/web/src/pages/owner-legal-control-types.ts';
const ENDPOINTS = 'apps/web/src/api/endpoints.ts';
const APP = 'apps/web/src/App.tsx';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-E3C1: Strategy Engine section on existing legal-control page, no new route/GET', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);
  const app = readRepo(APP);

  assert.match(page, /OwnerTaxKnowledgePanel/);
  assert.match(page, /OwnerStrategyEnginePanel/);
  assert.ok(page.indexOf('OwnerTaxKnowledgePanel') < page.indexOf('OwnerStrategyEnginePanel'));
  assert.match(page, /parseStrategyEngineAggregate\(panel\?\.strategy_engine\)/);
  assert.match(page, /OWNER\.legalControl/);
  assert.match(app, /path="\/platform-owner\/legal-control"/);
  assert.doesNotMatch(app, /strategy-engine/);
  assert.doesNotMatch(endpoints, /strategy-engine|strategy_engine/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/strategy/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]GET['"]/);
  assert.match(panel, /<h2[^>]*>Strategy Engine<\/h2>/);
});

test('TAX-E3C1: one country selection sends both existing GET query parameters', () => {
  const page = readRepo(PAGE);
  const types = readRepo(TYPES);
  const panel = readRepo(PANEL);

  assert.match(types, /export function ownerLegalControlCountryQueryParams/);
  assert.match(types, /tax_knowledge_country_code: code/);
  assert.match(types, /strategy_engine_country_code: code/);
  assert.match(page, /ownerLegalControlCountryQueryParams\(taxKnowledgeCountryQuery\)/);
  assert.match(page, /qs\.set\('tax_knowledge_country_code'/);
  assert.match(page, /qs\.set\('strategy_engine_country_code'/);
  assert.doesNotMatch(page, /strategyEngineCountryQuery|setStrategyEngineCountry|strategy_engine_country_query/);
  assert.doesNotMatch(panel, /strategyEngineCountry|onSelectCountry|Select country/);
});

test('TAX-E3C1: catalog display remains human-readable with no raw JSON / pin authoring', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);

  assert.doesNotMatch(panel, /CommandActionModal/);
  assert.doesNotMatch(panel, /JSON\.stringify/);
  assert.doesNotMatch(panel, /authored_metadata_json<\/textarea>|raw authored/i);
  assert.match(panel, /label="explanation"/);
  assert.match(panel, /label="benefits"/);
  assert.match(panel, /label="risks"/);
  assert.match(panel, /label="constraints"/);
  assert.match(panel, /label="costs_tradeoffs"/);
  assert.match(panel, /exactPinnedVersionLabel/);
  assert.match(panel, /strategyVersionLineageLabel/);
  assert.doesNotMatch(panel, /latest/i);
  assert.doesNotMatch(page, /CommandActionModal[\s\S]{0,80}strategy_engine/);
});

test('TAX-E3C1: Tax Knowledge shell remains on the same page', () => {
  const page = readRepo(PAGE);
  const tk = readRepo(TK_PANEL);
  assert.match(page, /OwnerTaxKnowledgePanel/);
  assert.match(tk, /<h2[^>]*>Tax Knowledge<\/h2>/);
  assert.match(tk, /tax_knowledge_country_code|onSelectCountry/);
  assert.match(tk, /create_tax_source/);
  assert.match(tk, /create_tax_rule/);
});

test('TAX-E3C1: no migration 613 and no new API surface in this slice', () => {
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_commands.sql')), false);
  const endpoints = readRepo(ENDPOINTS);
  assert.doesNotMatch(endpoints, /strategy-engine/);
});

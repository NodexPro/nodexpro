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

test('TAX-K2C contract: four named commands, no new GET/PATCH/route', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);
  const app = readRepo(APP);

  assert.match(panel, /onCommand\('update_tax_source_metadata'/);
  assert.match(panel, /onCommand\('activate_tax_source'/);
  assert.match(panel, /onCommand\('retire_tax_source'/);
  assert.match(panel, /onCommand\('update_tax_rule_metadata'/);
  assert.match(panel, /tax_source_id: selectedSource\.id/);
  assert.match(panel, /tax_rule_id: selectedRule\.id/);

  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /OWNER\.command/);
  assert.match(page, /OWNER\.legalControl/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/tax/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]PATCH['"]|method:\s*['"]GET['"]/);
  assert.doesNotMatch(endpoints, /tax-knowledge/);
  assert.doesNotMatch(app, /tax-knowledge/);
});

test('TAX-K2C contract: allowed_actions eligibility, no status inference, no hint catalog', () => {
  const panel = readRepo(PANEL);

  assert.match(panel, /enabledAction\(selectedSource\.allowed_actions/);
  assert.match(panel, /enabledAction\(selectedRule\.allowed_actions/);
  assert.match(panel, /selectedSourceId/);
  assert.match(panel, /selectedRuleId/);
  assert.doesNotMatch(panel, /status === ['"]draft['"]/);
  assert.doesNotMatch(panel, /status === ['"]active['"]/);
  assert.doesNotMatch(panel, /if \(selectedSource\.status/);
  assert.doesNotMatch(panel, /split\('\|'\)/);
  assert.doesNotMatch(panel, /TAX_SOURCE_PROVENANCE_TYPES|provenanceOptionsFromAction/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.doesNotMatch(panel, /selectedSourceObject|keptSource|cachedSource/);
});

test('TAX-K2C contract: no K2E+ command/UI leakage', () => {
  const panel = readRepo(PANEL);
  assert.doesNotMatch(panel, /onCommand\('create_tax_rule_relationship'/);
  assert.doesNotMatch(panel, /onCommand\('activate_tax_rule_version'/);
  assert.doesNotMatch(panel, /onCommand\('retire_tax_rule_version'/);
  assert.doesNotMatch(panel, /onCommand\('supersede_tax_rule_version'/);
  assert.doesNotMatch(panel, /latest.?version|superseded_by_version_id/i);
});

test('TAX-K2C contract: Tax Knowledge migrations and backend production files unchanged', () => {
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

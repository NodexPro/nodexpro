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

test('TAX-K2D contract: exact two named commands, no new GET/PATCH/route', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);
  const app = readRepo(APP);

  assert.match(panel, /onCommand\('create_tax_rule_version'/);
  assert.match(panel, /onCommand\('update_tax_rule_version_draft'/);
  assert.match(panel, /tax_rule_id: selectedRule\.id/);
  assert.match(panel, /tax_rule_version_id: selectedVersion\.id/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /OWNER\.command/);
  assert.match(page, /OWNER\.legalControl/);
  assert.match(page, /countryPacks=\{panel\?\.country_packs\}/);
  assert.match(page, /rulesets=\{panel\?\.rulesets\}/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/tax/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]PATCH['"]|method:\s*['"]GET['"]/);
  assert.doesNotMatch(endpoints, /tax-knowledge/);
  assert.doesNotMatch(app, /tax-knowledge/);
});

test('TAX-K2D contract: allowed_actions eligibility, ID selection, JSON syntax only', () => {
  const panel = readRepo(PANEL);

  assert.match(panel, /enabledAction\(selectedRule\?\.allowed_actions \?\? \[\], 'create_tax_rule_version'\)/);
  assert.match(panel, /enabledAction\(selectedVersion\?\.allowed_actions \?\? \[\], 'update_tax_rule_version_draft'\)/);
  assert.match(panel, /enabledAction\(selectedRule\.allowed_actions, actionKey\)/);
  assert.match(panel, /enabledAction\(selectedVersion\.allowed_actions, actionKey\)/);
  assert.match(panel, /selectedVersionId/);
  assert.match(panel, /JSON\.parse/);
  assert.match(panel, /payload_json must be a JSON object/);
  assert.doesNotMatch(panel, /status === ['"]draft['"]/);
  assert.doesNotMatch(panel, /if \(selectedVersion\.status/);
  assert.doesNotMatch(panel, /latest.?version|superseded_by_version_id/i);
  assert.doesNotMatch(panel, /taxRulePayloadChecksum|createHash|nextVersionNo|version_no \+ 1/);
  assert.doesNotMatch(panel, /ensureCountryPackAndRulesetForCountry/);
  assert.doesNotMatch(panel, /createPayload\.supersedes|supersedes_version_id: versionForm|field-label">supersedes_version_id/);
  assert.doesNotMatch(panel, /window\.confirm/);
});

test('TAX-K2D contract: no K2F+ command/UI leakage', () => {
  const panel = readRepo(PANEL);
  assert.doesNotMatch(panel, /onCommand\('activate_tax_rule_version'/);
  assert.doesNotMatch(panel, /onCommand\('retire_tax_rule_version'/);
  assert.doesNotMatch(panel, /onCommand\('close_tax_rule_version_effective_to'/);
  assert.doesNotMatch(panel, /onCommand\('supersede_tax_rule_version'/);
});

test('TAX-K2D contract: Tax Knowledge migrations and backend production files unchanged', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  const lockedBackend = [
    'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge-checksum.pure.ts',
    'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts',
    'apps/api/src/routes/owner-country-pack.routes.ts',
  ];
  for (const file of lockedBackend) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
});

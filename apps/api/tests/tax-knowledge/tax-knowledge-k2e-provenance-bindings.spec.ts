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

test('TAX-K2E contract: exact four named commands, no new GET/PATCH/route', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);
  const app = readRepo(APP);

  assert.match(panel, /onCommand\('pin_tax_rule_version_source'/);
  assert.match(panel, /onCommand\('unpin_tax_rule_version_source'/);
  assert.match(panel, /onCommand\('bind_tax_rule_version_legal_value'/);
  assert.match(panel, /onCommand\('unbind_tax_rule_version_legal_value'/);
  assert.match(panel, /tax_rule_version_id: selectedVersion\.id/);
  assert.match(panel, /tax_source_id: pinForm\.tax_source_id/);
  assert.match(panel, /tax_rule_version_source_id: pendingCitation\.id/);
  assert.match(panel, /legal_value_id: bindLegalValueId/);
  assert.match(panel, /tax_rule_version_legal_value_id: pendingBinding\.id/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /legalValues=\{panel\?\.legal_values\}/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/tax/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]PATCH['"]|method:\s*['"]GET['"]/);
  assert.doesNotMatch(endpoints, /tax-knowledge/);
  assert.doesNotMatch(app, /tax-knowledge/);
});

test('TAX-K2E contract: allowed_actions eligibility and no frontend domain inference', () => {
  const panel = readRepo(PANEL);

  assert.match(panel, /enabledAction\(selectedVersion\?\.allowed_actions \?\? \[\], 'pin_tax_rule_version_source'\)/);
  assert.match(panel, /enabledAction\(pendingCitation\.allowed_actions, 'unpin_tax_rule_version_source'\)/);
  assert.match(panel, /enabledAction\(selectedVersion\?\.allowed_actions \?\? \[\], 'bind_tax_rule_version_legal_value'\)/);
  assert.match(panel, /enabledAction\(pendingBinding\.allowed_actions, 'unbind_tax_rule_version_legal_value'\)/);
  assert.match(panel, /enabledAction\(citation\.allowed_actions, 'unpin_tax_rule_version_source'\)/);
  assert.match(panel, /enabledAction\(\s*binding\.allowed_actions,\s*'unbind_tax_rule_version_legal_value'/);
  assert.match(panel, /selectedVersionId/);
  assert.match(panel, /pendingCitationId/);
  assert.match(panel, /pendingBindingId/);
  assert.doesNotMatch(panel, /status === ['"]draft['"]/);
  assert.doesNotMatch(panel, /if \(selectedVersion\.status/);
  assert.doesNotMatch(panel, /source\.status ===|provenance_type === ['"]official/);
  assert.doesNotMatch(panel, /legal_value_version_id|as_of_date|current_active_value/);
  assert.doesNotMatch(panel, /rate:|threshold:|amount:/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.doesNotMatch(panel, /missing source|publication.?ready/i);
});

test('TAX-K2E contract: no K3+/Trainer leakage', () => {
  const panel = readRepo(PANEL);
  assert.doesNotMatch(panel, /Tax Knowledge Trainer|tax_knowledge_trainer|interpretation|strategy|calculation|work.?engine|impact resolver/i);
});

test('TAX-K2E contract: Tax Knowledge migrations and backend production files unchanged', () => {
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

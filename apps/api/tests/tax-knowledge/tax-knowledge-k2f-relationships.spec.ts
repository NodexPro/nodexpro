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
const BACKEND_TYPES = 'apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts';
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

const LOCKED_TYPES = [
  'depends_on',
  'conflicts_with',
  'exception_to',
  'overrides',
  'alternative_to',
  'special_case_of',
  'elaborates',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-K2F contract: exact two named commands, no new GET/PATCH/route', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);
  const app = readRepo(APP);

  assert.match(panel, /onCommand\('create_tax_rule_relationship'/);
  assert.match(panel, /onCommand\('delete_tax_rule_relationship'/);
  assert.match(panel, /from_tax_rule_version_id: selectedVersion\.id/);
  assert.match(panel, /to_tax_rule_version_id: relationshipForm\.to_tax_rule_version_id/);
  assert.match(panel, /tax_rule_relationship_id: pendingRelationship\.id/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/tax/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]PATCH['"]|method:\s*['"]GET['"]/);
  assert.doesNotMatch(endpoints, /tax-knowledge/);
  assert.doesNotMatch(app, /tax-knowledge/);
});

test('TAX-K2F contract: allowed_actions, locked types, no graph/reverse/latest inference', () => {
  const panel = readRepo(PANEL);
  const types = readRepo(TYPES);
  const backendTypes = readRepo(BACKEND_TYPES);

  assert.match(panel, /enabledAction\(selectedVersion\?\.allowed_actions \?\? \[\], 'create_tax_rule_relationship'\)/);
  assert.match(panel, /enabledAction\(pendingRelationship\.allowed_actions, 'delete_tax_rule_relationship'\)/);
  assert.match(panel, /enabledAction\(rel\.allowed_actions, 'delete_tax_rule_relationship'\)/);
  assert.match(panel, /TAX_KNOWLEDGE_RELATIONSHIP_TYPES/);
  assert.match(types, /export const TAX_KNOWLEDGE_RELATIONSHIP_TYPES/);
  for (const type of LOCKED_TYPES) {
    assert.match(types, new RegExp(`'${type}'`));
    assert.match(backendTypes, new RegExp(`'${type}'`));
  }
  assert.match(backendTypes, /export const TAX_RULE_RELATIONSHIP_TYPES/);
  assert.doesNotMatch(panel, /split\('\|'\)/);
  assert.doesNotMatch(panel, /status === ['"]draft['"]/);
  assert.doesNotMatch(panel, /if \(selectedVersion\.status/);
  assert.doesNotMatch(panel, /latest.?version/i);
  assert.doesNotMatch(panel, /conflicts_with A|reverse.?edge|createReverse|paired command/i);
  assert.doesNotMatch(panel, /onCommand\('create_tax_rule_relationship'[\s\S]{0,400}onCommand\('create_tax_rule_relationship'/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.doesNotMatch(panel, /publication.?ready|blocking relationship/i);
});

test('TAX-K2F contract: no K3+/Trainer leakage', () => {
  const panel = readRepo(PANEL);
  assert.doesNotMatch(panel, /Tax Knowledge Trainer|tax_knowledge_trainer|interpretation|strategy|calculation|work.?engine|impact resolver/i);
});

test('TAX-K2F contract: Tax Knowledge migrations and backend production files unchanged', () => {
  for (const file of KNOWLEDGE_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  const lockedBackend = [
    'apps/api/src/domains/tax-knowledge/tax-knowledge-checksum.pure.ts',
    'apps/api/src/routes/owner-country-pack.routes.ts',
  ];
  for (const file of lockedBackend) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
});

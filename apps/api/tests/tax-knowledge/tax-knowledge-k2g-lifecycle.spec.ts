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
const TYPES_TS = 'apps/web/src/pages/owner-legal-control-types.ts';
const ENDPOINTS = 'apps/web/src/api/endpoints.ts';
const APP = 'apps/web/src/App.tsx';
const COMMANDS = 'apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts';
const READ_MODELS = 'apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts';
const MIGRATION_605 = 'supabase/migrations/605_tax_knowledge_atomic_supersession.sql';

const KNOWLEDGE_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
] as const;

const K2G_COMMANDS = [
  'activate_tax_rule_version',
  'retire_tax_rule_version',
  'close_tax_rule_version_effective_to',
  'supersede_tax_rule_version',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-K2G contract: exact four named commands, no new GET/PATCH/route', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);
  const app = readRepo(APP);

  for (const command of K2G_COMMANDS) {
    assert.match(panel, new RegExp(`onCommand\\('${command}'`));
  }
  assert.match(panel, /tax_rule_version_id: selectedVersion\.id/);
  assert.match(panel, /effective_to: effectiveTo/);
  assert.match(panel, /new_tax_rule_version_id: pair\.new_tax_rule_version_id/);
  assert.match(panel, /old_tax_rule_version_id: pair\.old_tax_rule_version_id/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /OWNER\.command/);
  assert.match(page, /OWNER\.legalControl/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/tax/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]PATCH['"]|method:\s*['"]GET['"]/);
  assert.doesNotMatch(endpoints, /tax-knowledge/);
  assert.doesNotMatch(app, /tax-knowledge/);
  assert.equal((panel.match(/onCommand\('supersede_tax_rule_version'/g) ?? []).length, 1);
});

test('TAX-K2G contract: lifecycle buttons use allowed_actions only', () => {
  const panel = readRepo(PANEL);

  assert.match(panel, /K2G_VERSION_ACTION_KEYS/);
  assert.match(panel, />Lifecycle</);
  for (const command of K2G_COMMANDS) {
    assert.match(panel, new RegExp(`enabledAction\\(selectedVersion\\.allowed_actions, actionKey\\)`));
    assert.match(panel, new RegExp(`enabledAction\\(selectedVersion\\?\\.allowed_actions \\?\\? \\[\\], '${command}'\\)`));
  }
  assert.doesNotMatch(panel, /status === ['"]draft['"]/);
  assert.doesNotMatch(panel, /status === ['"]active['"]/);
  assert.doesNotMatch(panel, /if \(selectedVersion\.status/);
  assert.doesNotMatch(panel, /latestVersion|newestDraft|latest.?version/i);
  assert.doesNotMatch(panel, /publication.?ready|ready to activate|source-readiness|relationship-readiness/i);
  assert.doesNotMatch(panel, /missing active source|active citation exists/i);
  assert.doesNotMatch(panel, /window\.confirm/);
});

test('TAX-K2G contract: supersede uses backend payload/candidates only', () => {
  const panel = readRepo(PANEL);
  const types = readRepo(TYPES_TS);

  assert.match(panel, /parseSupersessionPairs/);
  assert.match(panel, /supersedePairsFromAction/);
  assert.match(panel, /row\.candidates/);
  assert.match(panel, /action\.candidates/);
  assert.match(types, /candidates\?: TaxKnowledgeSupersessionPair/);
  assert.match(types, /new_tax_rule_version_id: string/);
  assert.match(types, /old_tax_rule_version_id: string/);
  assert.doesNotMatch(panel, /eligibleSupersessionPairs|lineageCompatible/);
  assert.doesNotMatch(panel, /versions\.filter\([\s\S]{0,240}supersede/);
  assert.doesNotMatch(
    panel,
    /dialogKind === 'supersede_tax_rule_version'[\s\S]{0,800}onCommand\('retire_tax_rule_version'/,
  );
  assert.doesNotMatch(
    panel,
    /dialogKind === 'supersede_tax_rule_version'[\s\S]{0,800}onCommand\('activate_tax_rule_version'/,
  );
  assert.doesNotMatch(panel, /split\('\|'\)/);
});

test('TAX-K2G contract: activation and supersede remain backend-guarded', () => {
  const commands = readRepo(COMMANDS);
  const readModels = readRepo(READ_MODELS);
  const migration605 = readRepo(MIGRATION_605);

  assert.match(commands, /function handleActivateTaxRuleVersion/);
  assert.match(commands, /throwIfTaxRuleVersionLifecycleError/);
  assert.match(commands, /activate_tax_rule_version is only valid from draft to active/);
  assert.match(commands, /cannot activate without at least one citation/);
  assert.match(commands, /cannot activate while a blocking relationship/);
  assert.match(commands, /rpc\('tax_knowledge_supersede_tax_rule_version'/);
  assert.equal((commands.match(/rpc\('tax_knowledge_supersede_tax_rule_version'/g) ?? []).length, 1);
  assert.match(commands, /p_new_tax_rule_version_id: newId/);
  assert.match(commands, /p_old_tax_rule_version_id: oldId/);
  assert.match(readModels, /function supersedeAllowedAction/);
  assert.match(readModels, /candidates\.length === 1/);
  assert.match(migration605, /create or replace function public\.tax_knowledge_supersede_tax_rule_version/i);
});

test('TAX-K2G contract: no K3+/Trainer functionality leakage', () => {
  const panel = readRepo(PANEL);
  const types = readRepo(TYPES_TS);
  assert.doesNotMatch(panel, /Tax Knowledge Trainer|tax_knowledge_trainer|work.?engine|impact resolver/i);
  assert.doesNotMatch(types, /TaxKnowledgeTrainer|tax_interpretation|tax_strategy/);
  assert.doesNotMatch(panel, /recursive impact|client facts|advisory logic/i);
});

test('TAX-K2G contract: Tax Knowledge migrations and backend production files unchanged', () => {
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

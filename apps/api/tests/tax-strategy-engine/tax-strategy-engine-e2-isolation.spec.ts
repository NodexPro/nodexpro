import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const FROZEN_MIGRATIONS = [
  'supabase/migrations/600_tax_knowledge_core_foundation.sql',
  'supabase/migrations/601_tax_knowledge_provenance_links.sql',
  'supabase/migrations/602_tax_knowledge_publication_guard.sql',
  'supabase/migrations/603_tax_knowledge_rule_relationships.sql',
  'supabase/migrations/604_tax_knowledge_relationship_publication_guard.sql',
  'supabase/migrations/605_tax_knowledge_atomic_supersession.sql',
  'supabase/migrations/606_tax_knowledge_service_role_dml.sql',
  'supabase/migrations/607_tax_knowledge_legal_links_unresolved.sql',
  'supabase/migrations/608_tax_calculation_engine_foundation.sql',
  'supabase/migrations/609_tax_calculation_engine_privilege_hardening.sql',
  'supabase/migrations/610_tax_calculation_engine_runtime_dependency_privileges.sql',
  'supabase/migrations/611_country_pack_legal_value_versions_privilege_hardening.sql',
] as const;

const E1_FILES = [
  'apps/api/src/domains/tax-strategy-engine/tax-strategy-engine.types.ts',
  'apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-evaluate.pure.ts',
  'apps/api/tests/tax-strategy-engine/tax-strategy-engine-e1-evaluate.spec.ts',
  'apps/api/tests/tax-strategy-engine/tax-strategy-engine-e1-isolation.spec.ts',
] as const;

function gitDiff(rel: string): string {
  return execSync(`git diff -- ${rel}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

test('TAX-E2 isolation: migrations 600–611 untouched', () => {
  for (const file of FROZEN_MIGRATIONS) {
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
});

test('TAX-E2 isolation: E1 source and tests untouched', () => {
  for (const file of E1_FILES) {
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
});

test('TAX-E2 isolation: K3 and K4 sources untouched', () => {
  const k3 = execSync('git diff --name-only -- apps/api/src/domains/tax-rule-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const k4 = execSync('git diff --name-only -- apps/api/src/domains/tax-calculation-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const k3Tests = execSync('git diff --name-only -- apps/api/tests/tax-rule-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const k4Tests = execSync('git diff --name-only -- apps/api/tests/tax-calculation-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  assert.equal(k3, '', 'K3 sources must remain unchanged');
  assert.equal(k4, '', 'K4 sources must remain unchanged');
  assert.equal(k3Tests, '', 'K3 tests must remain unchanged');
  assert.equal(k4Tests, '', 'K4 tests must remain unchanged');
});

test('TAX-E2 isolation: 612 is the only new Tax Brain migration', () => {
  const taxBrain = readdirSync(join(repoRoot, 'supabase/migrations'))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= 600 && Number(name.slice(0, 3)) <= 699)
    .sort();
  assert.ok(taxBrain.includes('612_tax_strategy_engine_foundation.sql'));
  assert.equal(
    taxBrain.filter((name) => Number(name.slice(0, 3)) > 612).length,
    0,
    'no migration after 612',
  );
  const changedMigrations = execSync('git diff --name-only -- supabase/migrations', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.deepEqual(changedMigrations, [], 'tracked Tax Brain migrations must not be edited');
});

test('TAX-E2 isolation: no commands, aggregates, routes, or UI in this slice', () => {
  const e2Sql = readFileSync(join(repoRoot, 'supabase/migrations/612_tax_strategy_engine_foundation.sql'), 'utf8');
  assert.doesNotMatch(e2Sql, /create_tax_strategy|activate_tax_strategy_version|pin_strategy_rule/);
  assert.doesNotMatch(e2Sql, /owner_legal_control_panel_aggregate/);
  assert.doesNotMatch(e2Sql, /router\.(get|post|patch)/i);

  const srcCmd = execSync('git diff --name-only -- apps/api/src/domains/tax-strategy-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  assert.equal(srcCmd, '', 'E2 must not add Strategy Engine TypeScript in this slice');

  const web = execSync('git diff --name-only -- apps/web', { cwd: repoRoot, encoding: 'utf8' }).trim();
  assert.equal(web, '', 'E2 must not change the web client');
});

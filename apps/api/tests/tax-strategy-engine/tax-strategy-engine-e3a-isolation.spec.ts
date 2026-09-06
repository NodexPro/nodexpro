import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTaxKnowledgeCommand } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { isTaxStrategyEngineCommand } from '../../src/domains/tax-strategy-engine/tax-strategy-engine-commands.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const E3A_SRC_FILES = [
  'apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-checksum.pure.ts',
  'apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-commands.types.ts',
  'apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-read-models.pure.ts',
  'apps/api/src/domains/tax-strategy-engine/owner-read/tax-strategy-engine-read-models.service.ts',
] as const;

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
  'supabase/migrations/612_tax_strategy_engine_foundation.sql',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function walkTs(relDir: string): string[] {
  const abs = join(repoRoot, relDir);
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const next = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) return walkTs(next);
    return entry.name.endsWith('.ts') ? [next] : [];
  });
}

test('TAX-E3A isolation: no Accounting Base / Work Engine / Income / new endpoint', () => {
  const forbidden = [
    'accounting-base',
    'work-engine',
    '../income/',
    'income-document-draft',
    'evaluateTaxStrategies',
    'evaluateTaxRules',
    'evaluateTaxCalculation',
    'executeTaxStrategyEngineCommand',
    'implemented_commands',
    'organization_id',
    'client_id',
    'case_id',
  ];
  for (const file of E3A_SRC_FILES) {
    const text = readRepo(file);
    for (const needle of forbidden) {
      assert.equal(text.includes(needle), false, `${file} contains ${needle}`);
    }
  }

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /router\.get\('\/legal-control'/);
  assert.doesNotMatch(routes, /router\.get\('\/strategy-engine'/);
  assert.doesNotMatch(routes, /router\.post\('\/strategy/);
});

test('TAX-E3A isolation: Strategy commands stay out of Tax Knowledge types', () => {
  assert.equal(isTaxKnowledgeCommand('create_tax_strategy'), false);
  assert.equal(isTaxKnowledgeCommand('activate_tax_strategy_version'), false);
  assert.equal(isTaxStrategyEngineCommand('create_tax_strategy'), true);
  const tkTypes = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  assert.doesNotMatch(tkTypes, /tax_strategy|create_tax_strategy/);
});

test('TAX-E3A isolation: migrations 600–612 untouched, no 613', () => {
  for (const file of FROZEN_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
    assert.equal(diff, '', `${file} must remain unchanged`);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_commands.sql')), false);
});

test('TAX-E3A isolation: no tenant fields in Strategy canonical read files', () => {
  for (const file of walkTs('apps/api/src/domains/tax-strategy-engine')) {
    const text = readRepo(file);
    assert.doesNotMatch(text, /organization_id/, file);
    assert.doesNotMatch(text, /client_id/, file);
    assert.doesNotMatch(text, /case_id/, file);
  }
});

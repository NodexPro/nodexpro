import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasLatestVersionResolver } from '../../src/domains/tax-strategy-engine/tax-strategy-engine.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const SOURCE_DIR = join(dir, '../../src/domains/tax-strategy-engine');

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

function sourceFiles(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(SOURCE_DIR, name));
}

test('TAX-E1 27: no org/client/tenant scope', () => {
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /organization_id/, file);
    assert.doesNotMatch(text, /client_id/, file);
    assert.doesNotMatch(text, /case_id/, file);
  }
});

test('TAX-E1 28: no latest resolution', () => {
  assert.equal(hasLatestVersionResolver(), false);
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('latest_version'), false, file);
    assert.equal(text.includes('resolveLatest'), false, file);
    assert.equal(/latest[-_ ]version/.test(text), false, file);
  }
});

test('TAX-E1 29: isolation from Accounting Base / Work Engine / Income', () => {
  const forbidden = [
    'accounting-base',
    'work-engine',
    'income-draft',
    'income-document-draft-totals',
    '../income/',
    '../accounting-base/',
    '../work-engine/',
    'docflow',
  ];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      assert.equal(text.includes(needle), false, `${file} contains ${needle}`);
    }
  }
});

test('TAX-E1 30: does not invoke or reimplement TRE or K4', () => {
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /evaluateTaxRules/);
    assert.doesNotMatch(text, /evaluateAppliesIf/);
    assert.doesNotMatch(text, /evaluateTaxRulePredicate/);
    assert.doesNotMatch(text, /evaluateTaxCalculation/);
    assert.doesNotMatch(text, /evaluateTaxCalculationWithContext/);
    assert.doesNotMatch(text, /runCalculateTax/);
    assert.doesNotMatch(text, /parseCalculateTaxCommandPayload/);
    assert.doesNotMatch(text, /tax-calculation-engine-evaluate/);
    assert.doesNotMatch(text, /tax-calculation-engine-calculate/);
    assert.doesNotMatch(text, /tax-calculation-engine-context\.pure/);
    assert.doesNotMatch(text, /tax-rule-engine-evaluate/);
    assert.doesNotMatch(text, /tax-rule-engine-predicate/);
    assert.doesNotMatch(text, /tax-rule-engine-commands/);
    assert.doesNotMatch(text, /openai|anthropic|llm|confidence/i);
    assert.doesNotMatch(text, /\brecommend|\branking\b|\bconfidence_percent\b/i);
    assert.doesNotMatch(text, /@supabase\/supabase-js/);
    assert.doesNotMatch(text, /from 'pg'/);
    assert.doesNotMatch(text, /\.from\('/);
    assert.doesNotMatch(text, /router\.(get|patch|put)/i);
  }
});

test('TAX-E1 31: migrations 600–611 untouched', () => {
  for (const file of FROZEN_MIGRATIONS) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
  const extra = execSync('git diff --name-only -- supabase/migrations', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => !name.includes('624_knowledge_trainer_ingestion_foundation.sql'));
  assert.deepEqual(extra, []);
});

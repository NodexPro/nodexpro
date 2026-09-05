import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAX_KNOWLEDGE_ERROR_CODES } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-K3B contract: activate validates predicates; draft writes do not', () => {
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-commands.service.ts');
  assert.match(commands, /validateTaxRulePayloadPredicates\(version\.payload_json/);
  assert.match(commands, /TAX_KNOWLEDGE_ERROR_CODES\.INVALID_PREDICATE/);
  assert.equal((commands.match(/validateTaxRulePayloadPredicates\(/g) ?? []).length, 1);
  assert.match(commands, /async function handleActivateTaxRuleVersion/);
  assert.doesNotMatch(commands, /handleCreateTaxRuleVersion[\s\S]{0,400}validateTaxRulePayloadPredicates\(/);
  assert.doesNotMatch(commands, /handleUpdateTaxRuleVersionDraft[\s\S]{0,400}validateTaxRulePayloadPredicates\(/);

  assert.equal(TAX_KNOWLEDGE_ERROR_CODES.INVALID_PREDICATE, 'TAX_KNOWLEDGE_INVALID_PREDICATE');
});

test('TAX-K3B contract: no K3C legal links, no migration, no UI', () => {
  const engineDir = readRepo('apps/api/src/domains/tax-rule-engine/tax-rule-engine.types.ts');
  assert.match(engineDir, /export function isCanonicalIsoDate/);
  assert.doesNotMatch(engineDir, /new Date\(|Date\.parse|Date\.UTC/);
  assert.doesNotMatch(engineDir, /applies_with|calculation_basis|procedural_requirement|unresolved_legal/);
  assert.doesNotMatch(engineDir, /openai|anthropic|llm/i);

  const migrations = readdirSync(join(repoRoot, 'supabase/migrations'));
  assert.equal(
    migrations.some((name) => /^607_/.test(name)),
    false,
    'K3B must not add migration 607',
  );
  for (const file of [
    'supabase/migrations/600_tax_knowledge_core_foundation.sql',
    'supabase/migrations/606_tax_knowledge_service_role_dml.sql',
    'supabase/migrations/163_country_pack_service_role_dml.sql',
  ]) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }

  const panel = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  assert.doesNotMatch(panel, /evaluation_as_of|type_mismatch|TAX_KNOWLEDGE_INVALID_PREDICATE/);
});

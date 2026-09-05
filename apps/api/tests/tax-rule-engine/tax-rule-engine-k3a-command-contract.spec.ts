import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAX_KNOWLEDGE_COMMANDS, isTaxKnowledgeCommand } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import {
  TAX_RULE_ENGINE_AGGREGATE_KEY,
  TAX_RULE_ENGINE_COMMANDS,
  isTaxRuleEngineCommand,
} from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';

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
  'supabase/migrations/163_country_pack_service_role_dml.sql',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-K3A contract: evaluate_tax_rules is a command-bus evaluate, not a TK write', () => {
  assert.deepEqual([...TAX_RULE_ENGINE_COMMANDS], ['evaluate_tax_rules']);
  assert.equal(isTaxRuleEngineCommand('evaluate_tax_rules'), true);
  assert.equal(isTaxKnowledgeCommand('evaluate_tax_rules'), false);
  assert.equal((TAX_KNOWLEDGE_COMMANDS as readonly string[]).includes('evaluate_tax_rules'), false);
  assert.equal(TAX_RULE_ENGINE_AGGREGATE_KEY, 'tax_rule_engine_evaluation_aggregate');

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /isTaxRuleEngineCommand\(commandName\)/);
  assert.match(routes, /executeTaxRuleEngineCommand/);
  assert.match(routes, /router\.post\('\/command'/);
  assert.doesNotMatch(routes, /router\.get\('\/tax-rule-engine'/);
  assert.doesNotMatch(routes, /router\.get\('\/evaluate/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);

  const commands = readRepo('apps/api/src/domains/tax-rule-engine/tax-rule-engine-commands.service.ts');
  assert.match(commands, /export async function executeTaxRuleEngineCommand/);
  assert.match(commands, /assertPlatformOwner\(ctx\)/);
  assert.match(commands, /parseEvaluateTaxRulesInput/);
  assert.match(commands, /buildTaxRuleEngineEvaluationAggregate/);
  assert.match(commands, /aggregate_key: TAX_RULE_ENGINE_AGGREGATE_KEY/);
  assert.doesNotMatch(commands, /writeAudit|AUDIT_ACTIONS/);
  assert.doesNotMatch(commands, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(commands, /owner_legal_control_panel_aggregate/);
  assert.doesNotMatch(commands, /organization_id/);
});

test('TAX-K3A contract: loader is same-country select-only and does not resolve legal rates', () => {
  const loader = readRepo('apps/api/src/domains/tax-rule-engine/tax-rule-engine-read-models.service.ts');
  assert.match(loader, /export async function buildTaxRuleEngineEvaluationAggregate/);
  assert.match(loader, /assertPlatformOwner\(ctx\)/);
  assert.match(loader, /assertCountryExists/);
  assert.match(loader, /\.eq\('country_code', countryCode\)/);
  assert.match(loader, /\.eq\('status', 'active'\)/);
  assert.match(loader, /versionInEffectiveWindow/);
  assert.match(loader, /evaluateTaxRules\(/);
  assert.match(loader, /LEGAL_VALUE_SELECT = 'id, value_key, label'/);
  assert.doesNotMatch(loader, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(loader, /organization_id|client_id|work_engine|accounting/i);
  assert.doesNotMatch(loader, /numeric_value|rate_value|amount|vat|payroll/i);
  assert.doesNotMatch(loader, /openai|anthropic|llm|completion/i);
});

test('TAX-K3A contract: engine does not own authoring UI or TK allowed_actions', () => {
  const tkRead = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge-read-models.service.ts');
  assert.doesNotMatch(tkRead, /evaluate_tax_rules/);
  assert.doesNotMatch(tkRead, /tax_rule_engine_evaluation_aggregate/);

  const panel = readRepo('apps/web/src/pages/owner-tax-knowledge-panel.tsx');
  assert.doesNotMatch(panel, /evaluate_tax_rules/);
  assert.doesNotMatch(panel, /applicable|not_applicable|undetermined/);

  const types = readRepo('apps/api/src/domains/tax-rule-engine/tax-rule-engine.types.ts');
  assert.doesNotMatch(types, /\bvat\b|\bpayroll\b|\btotal\b|\bamount\b|\brate\b/i);
  assert.match(types, /applicable: TaxRuleEngineEvaluatedRule/);
  assert.match(types, /not_applicable: TaxRuleEngineEvaluatedRule/);
  assert.match(types, /undetermined: TaxRuleEngineEvaluatedRule/);
  assert.match(types, /type_mismatch/);
});

test('TAX-K3A contract: no new migration; 600–606 and 163 stay untouched', () => {
  const migrations = readdirSync(join(repoRoot, 'supabase/migrations'));
  assert.equal(
    migrations.some((name) => /^607_/.test(name)),
    false,
    'K3A Rule Engine must not add migration 607',
  );

  for (const file of FROZEN_MIGRATIONS) {
    assert.equal(existsSync(join(repoRoot, file)), true, file);
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(diff.trim(), '', `${file} must remain unchanged`);
  }
});

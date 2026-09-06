import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAX_KNOWLEDGE_COMMANDS, isTaxKnowledgeCommand } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { TAX_RULE_ENGINE_COMMANDS } from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';
import {
  TAX_CALCULATION_ENGINE_COMMANDS,
  TAX_CALCULATION_RESULT_AGGREGATE_KEY,
  isTaxCalculationEngineCommand,
} from '../../src/domains/tax-calculation-engine/tax-calculation-engine-commands.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-K4C 1: calculate_tax dispatches through existing owner command bus', () => {
  assert.deepEqual([...TAX_CALCULATION_ENGINE_COMMANDS], ['calculate_tax']);
  assert.equal(isTaxCalculationEngineCommand('calculate_tax'), true);
  assert.equal(isTaxKnowledgeCommand('calculate_tax'), false);
  assert.equal((TAX_KNOWLEDGE_COMMANDS as readonly string[]).includes('calculate_tax'), false);
  assert.equal((TAX_RULE_ENGINE_COMMANDS as readonly string[]).includes('calculate_tax'), false);
  assert.equal(TAX_CALCULATION_RESULT_AGGREGATE_KEY, 'tax_calculation_result_aggregate');

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /router\.post\('\/command'/);
  assert.match(routes, /isTaxCalculationEngineCommand\(commandName\)/);
  assert.match(routes, /executeTaxCalculationCommand/);
  assert.doesNotMatch(routes, /router\.get\('\/tax-calculation/);
  assert.doesNotMatch(routes, /router\.get\('\/calculate_tax/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
});

test('TAX-K4C 2/7 audit: evaluate-command pattern, no DB write and no TK refresh', () => {
  const commands = readRepo('apps/api/src/domains/tax-calculation-engine/tax-calculation-engine-commands.service.ts');
  assert.match(commands, /export async function executeTaxCalculationCommand/);
  assert.match(commands, /assertPlatformOwner\(ctx\)/);
  assert.match(commands, /runCalculateTax/);
  assert.doesNotMatch(commands, /writeAudit|AUDIT_ACTIONS/);
  assert.doesNotMatch(commands, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(commands, /owner_legal_control_panel_aggregate/);
  assert.doesNotMatch(commands, /evaluate_tax_rules/);
  assert.doesNotMatch(commands, /evaluateTaxRules/);
  assert.doesNotMatch(commands, /resolveLegalValue|resolveCountryContext/);
});

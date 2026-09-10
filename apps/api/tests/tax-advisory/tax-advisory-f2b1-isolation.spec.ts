import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const SOURCE_DIR = join(dir, '../../src/domains/tax-advisory');
const WEB_PAGE = join(repoRoot, 'apps/web/src/pages/TaxAdvisoryClientPage.tsx');

function sourceFiles(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(SOURCE_DIR, name));
}

function readAllDomain(): string {
  return sourceFiles().map((file) => readFileSync(file, 'utf8')).join('\n');
}

test('TAX-F2B1 isolation: no K3/K4/Strategy evaluate, no Owner HTTP, no AB/WE writes', () => {
  const text = readAllDomain();
  assert.doesNotMatch(text, /evaluateTaxRules/);
  assert.doesNotMatch(text, /runCalculateTax/);
  assert.doesNotMatch(text, /evaluateTaxStrategies/);
  assert.doesNotMatch(text, /tax_calculation_runs/);
  assert.doesNotMatch(text, /intakeWorkEvent/);
  assert.doesNotMatch(text, /work_items/);
  assert.doesNotMatch(text, /accounting_entries/);
  assert.doesNotMatch(text, /assertPlatformOwner/);
  assert.doesNotMatch(text, /\/api\/v1\/owner\/command/);
  assert.doesNotMatch(text, /openai|anthropic|\bllm\b/i);
  assert.doesNotMatch(text, /router\.(patch|put)/i);
  assert.doesNotMatch(text, /facts_completeness|unanswered_required_fact_keys|tax_complete/);
});

test('TAX-F2B1 commands are named and tenant-scoped', () => {
  const commands = readFileSync(join(SOURCE_DIR, 'tax-advisory-commands.service.ts'), 'utf8');
  const routes = readFileSync(join(SOURCE_DIR, 'tax-advisory.routes.ts'), 'utf8');
  assert.match(commands, /create_tax_advisory_case/);
  assert.match(commands, /set_tax_advisory_case_fact/);
  assert.match(commands, /clear_tax_advisory_case_fact/);
  assert.match(commands, /archive_tax_advisory_case/);
  assert.match(routes, /requireModuleActive\(TAX_ADVISORY_MODULE_CODE\)/);
  assert.match(routes, /requirePermission\(TAX_ADVISORY_PERMISSIONS\.view\)/);
  assert.match(routes, /requirePermission\(TAX_ADVISORY_PERMISSIONS\.edit\)/);
  assert.match(routes, /authMiddleware/);
  assert.match(routes, /requireOrg/);
  assert.doesNotMatch(commands, /evaluate_tax_advisory_case/);
  assert.doesNotMatch(commands, /create_tax_advisory_scenario/);
  assert.match(commands, /\.eq\('organization_id', orgId\)/);
  const reads = readFileSync(join(SOURCE_DIR, 'tax-advisory-read-models.service.ts'), 'utf8');
  assert.match(reads, /\.eq\('id', clientId\)/);
  assert.match(reads, /\.eq\('organization_id', orgId\)/);
  assert.match(reads, /\.eq\('id', caseId\)/);
});

test('TAX-F2B1 audit payloads omit raw values', () => {
  const commands = readFileSync(join(SOURCE_DIR, 'tax-advisory-commands.service.ts'), 'utf8');
  const auditBlocks = commands.split('auditTaxAdvisory');
  for (const block of auditBlocks.slice(1)) {
    const payloadAt = block.indexOf('payload:');
    if (payloadAt < 0) continue;
    const slice = block.slice(payloadAt, payloadAt + 500);
    assert.doesNotMatch(slice, /value_json/);
    assert.doesNotMatch(slice, /payload\.value/);
    assert.doesNotMatch(slice, /typedValue/);
  }
  assert.doesNotMatch(commands, /console\.(log|info|debug|error)\([^)]*value_json/);
  assert.doesNotMatch(commands, /console\.(log|info|debug)\([^)]*payload/);
});

test('TAX-F2B1 UI is thin and does not invent completeness', () => {
  const ui = readFileSync(WEB_PAGE, 'utf8');
  assert.match(ui, /taxAdvisoryClientWorkspace/);
  assert.match(ui, /taxAdvisoryCommands/);
  assert.match(ui, /evaluation_notice/);
  assert.doesNotMatch(ui, /facts_completeness|tax_complete|unanswered_required/);
  assert.doesNotMatch(ui, /evaluate_tax_advisory_case/);
  assert.doesNotMatch(ui, /method:\s*'PATCH'/);
});
